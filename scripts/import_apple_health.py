"""Stream an Apple Health XML export into a local, provenance-aware daily summary.

No third-party packages. Raw XML is never served by the web application.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, time, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
HK = timezone(timedelta(hours=8))
PREFIX = 'HKQuantityTypeIdentifier'
SUM_FIELDS = {
    'StepCount': ('steps', 'count'),
    'ActiveEnergyBurned': ('activeKcal', 'kcal'),
    'BasalEnergyBurned': ('restingKcal', 'kcal'),
    'DistanceWalkingRunning': ('distanceKm', 'km'),
    'FlightsClimbed': ('flights', 'count'),
    'AppleExerciseTime': ('exerciseMinutes', 'min'),
    'DietaryEnergyConsumed': ('caloriesKcal', 'kcal'),
    'DietaryProtein': ('proteinG', 'g'),
    'DietaryCarbohydrates': ('carbsG', 'g'),
    'DietaryFatTotal': ('fatG', 'g'),
    'DietaryWater': ('waterMl', 'mL'),
}
POINT_FIELDS = {
    'BodyMass': ('weightKg', 'kg'),
    'BodyFatPercentage': ('bodyFatPct', '%'),
    'LeanBodyMass': ('leanMassKg', 'kg'),
    'BodyMassIndex': ('deviceBMI', 'count'),
    'RestingHeartRate': ('restingHeartRate', 'count/min'),
    'HeartRateVariabilitySDNN': ('hrvMs', 'ms'),
    'VO2Max': ('vo2Max', 'mL/min·kg'),
}
ASLEEP = {
    'HKCategoryValueSleepAnalysisAsleep',
    'HKCategoryValueSleepAnalysisAsleepUnspecified',
    'HKCategoryValueSleepAnalysisAsleepCore',
    'HKCategoryValueSleepAnalysisAsleepDeep',
    'HKCategoryValueSleepAnalysisAsleepREM',
}


def timestamp(value):
    return datetime.strptime(value, '%Y-%m-%d %H:%M:%S %z').astimezone(HK)


def split_interval(start, end):
    """Yield day, start, end, fraction; split cumulative values at local midnight."""
    if end <= start:
        yield start.date().isoformat(), start, start, 1.0
        return
    duration = (end - start).total_seconds()
    cursor = start
    while cursor < end:
        midnight = datetime.combine(cursor.date() + timedelta(days=1), time(), HK)
        stop = min(end, midnight)
        yield cursor.date().isoformat(), cursor, stop, (stop - cursor).total_seconds() / duration
        cursor = stop


def union_hours(intervals):
    if not intervals:
        return 0.0
    ordered = sorted(intervals)
    start, end = ordered[0]
    total = 0
    for a, b in ordered[1:]:
        if a > end:
            total += (end - start).total_seconds()
            start, end = a, b
        else:
            end = max(end, b)
    return (total + (end - start).total_seconds()) / 3600


def import_health(file):
    daily = defaultdict(lambda: {'sources': {}})
    sums = defaultdict(lambda: defaultdict(float))
    points = {}
    sleeps = defaultdict(lambda: defaultdict(list))
    counts, skipped = Counter(), Counter()
    unique = set()
    workouts = []
    export_date = None
    now = datetime.now(HK)
    stream = ET.iterparse(file, events=('start', 'end'))
    _, root = next(stream)
    if root.tag != 'HealthData':
        raise ValueError('文件不是 Apple 健康导出的 HealthData XML。')
    for event, elem in stream:
        if event != 'end':
            continue
        if elem.tag == 'ExportDate':
            export_date = elem.get('value')
        if elem.tag == 'Record':
            a = elem.attrib
            raw_type = a.get('type', '')
            counts[raw_type] += 1
            short = raw_type.removeprefix(PREFIX)
            is_sleep = raw_type == 'HKCategoryTypeIdentifierSleepAnalysis'
            if short not in SUM_FIELDS and short not in POINT_FIELDS and not is_sleep:
                elem.clear()
                root.clear()
                continue
            try:
                start, end = timestamp(a['startDate']), timestamp(a['endDate'])
                if start > now or end < start or end - start > timedelta(days=7):
                    raise ValueError('invalid time')
                source = a.get('sourceName', 'Apple Health')
                identity = tuple(a.get(k, '') for k in ('type', 'sourceName', 'startDate', 'endDate', 'value', 'unit'))
                digest = hashlib.sha256(repr(identity).encode()).digest()
                if digest in unique:
                    skipped['exactDuplicates'] += 1
                    elem.clear()
                    root.clear()
                    continue
                unique.add(digest)
                if is_sleep:
                    value = a.get('value')
                    key = 'sleepHours' if value in ASLEEP else 'inBedHours' if value == 'HKCategoryValueSleepAnalysisInBed' else None
                    if key:
                        for day, left, right, _ in split_interval(start, end):
                            sleeps[(day, key)][source].append((left, right))
                else:
                    key, unit = (SUM_FIELDS if short in SUM_FIELDS else POINT_FIELDS)[short]
                    value = float(a['value'])
                    if not math.isfinite(value) or value < 0:
                        raise ValueError('invalid value')
                    if a.get('unit') != unit:
                        skipped['unsupportedUnits'] += 1
                        elem.clear()
                        root.clear()
                        continue
                    # Apple exports percent-unit quantities as fractions (0.30 = 30%).
                    if key == 'bodyFatPct':
                        value *= 100
                        if value > 100:
                            raise ValueError('invalid fraction')
                    if short in SUM_FIELDS:
                        for day, _, _, fraction in split_interval(start, end):
                            sums[(day, key)][source] += value * fraction
                    else:
                        day = start.date().isoformat()
                        previous = points.get((day, key))
                        if previous is None or start >= previous[0]:
                            points[(day, key)] = (start, value, source)
            except (ValueError, KeyError, OverflowError):
                skipped['invalidRecords'] += 1
            elem.clear()
            root.clear()
        elif elem.tag == 'Workout':
            counts['Workout'] += 1
            a = elem.attrib
            try:
                start, end = timestamp(a['startDate']), timestamp(a['endDate'])
                if start > now or end < start:
                    raise ValueError('invalid workout time')
                duration = float(a.get('duration', '0'))
                unit = a.get('durationUnit', 'min')
                factor = {'min': 1, 's': 1 / 60, 'hr': 60}.get(unit)
                if factor is None or not math.isfinite(duration) or duration < 0:
                    raise ValueError('invalid workout duration')
                identity = tuple(a.get(k, '') for k in ('workoutActivityType', 'sourceName', 'startDate', 'endDate'))
                digest = hashlib.sha256(repr(identity).encode()).digest()
                if digest not in unique:
                    unique.add(digest)
                    workouts.append({
                        'date': start.date().isoformat(), 'start': start.isoformat(), 'end': end.isoformat(),
                        'type': a.get('workoutActivityType', '').removeprefix('HKWorkoutActivityType'),
                        'minutes': round(duration * factor, 1), 'source': a.get('sourceName', 'Apple Health')
                    })
                else:
                    skipped['exactDuplicates'] += 1
            except (ValueError, KeyError):
                skipped['invalidWorkouts'] += 1
            elem.clear()
            root.clear()
    for (day, key), sources in sums.items():
        # Do not add phone + watch samples together. Export lacks Health app priority.
        selected, value = max(sources.items(), key=lambda pair: (pair[1], pair[0]))
        daily[day][key] = round(value) if key in ('steps', 'flights') else round(value, 2)
        daily[day]['sources'][key] = selected
    for (day, key), (_, value, source) in points.items():
        daily[day][key] = round(value, 2)
        daily[day]['sources'][key] = source
    for (day, key), sources in sleeps.items():
        totals = {source: union_hours(intervals) for source, intervals in sources.items()}
        source, value = max(totals.items(), key=lambda pair: (pair[1], pair[0]))
        daily[day][key] = round(value, 2)
        daily[day]['sources'][key] = source
    # Workout sessions are kept separately; overlapping sessions never inflate daily time.
    workout_intervals = defaultdict(list)
    for row in workouts:
        for day, left, right, _ in split_interval(datetime.fromisoformat(row['start']), datetime.fromisoformat(row['end'])):
            workout_intervals[day].append((left, right))
    for day, intervals in workout_intervals.items():
        daily[day]['deviceWorkoutMinutes'] = round(union_hours(intervals) * 60, 1)
        daily[day]['sources']['deviceWorkoutMinutes'] = 'Apple Health 导出的运动时段（重叠取并集）'
    days = [dict(date=date, **daily[date]) for date in sorted(daily)]
    metrics = {}
    for row in days:
        for key, value in row.items():
            if isinstance(value, (float, int)):
                summary = metrics.setdefault(key, {'days': 0, 'firstDate': row['date']})
                summary.update(days=summary['days'] + 1, lastDate=row['date'], latest=value)
    return {
        'schemaVersion': 1, 'kind': 'apple-health-summary', 'timeZone': 'Asia/Hong_Kong',
        'importedAt': now.isoformat(), 'exportDate': export_date,
        'rawRecordCount': sum(n for k, n in counts.items() if k != 'Workout'),
        'workoutCount': len(workouts), 'recordTypes': dict(counts), 'skipped': dict(skipped),
        'metrics': metrics, 'daily': days, 'workouts': sorted(workouts, key=lambda row: row['start']),
        'method': {
            'cumulative': '同一天同一指标选择合计最大的单一来源，不叠加手机与手表；与健康 App 的来源优先级算法可能不同。',
            'duplicates': '同类型、来源、时间、数值和单位的完全重复样本去重。',
            'measurements': '体重、体脂等保留当天最后一次样本；手动记录在页面上优先，原始导入值仍保留。',
            'sleep': '仅 Asleep 类计入睡眠；InBed 仅计卧床。按 UTC+8 日历日拆分跨午夜时段，来源内重叠取并集。',
            'energy': '设备活动热量和基础热量均为估算；饮食样本可能不完整。应用不据此计算确定的热量缺口。',
            'workouts': '保留设备运动时段，不自动标记计划训练完成；每日时长为时段并集，可能包含暂停时间。',
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=Path, nargs='?')
    parser.add_argument('--output', type=Path, default=ROOT / 'data' / 'apple-health.json')
    args = parser.parse_args()
    source = args.input
    if source is None:
        candidates = [p for folder in (ROOT / 'imports', ROOT / '导出') if folder.exists() for p in folder.rglob('*.xml') if p.name != 'export_cda.xml']
        if not candidates:
            parser.error('请指定健康导出的 XML，或放在 imports 文件夹内。')
        source = max(candidates, key=lambda p: p.stat().st_size)
    source, output = source.resolve(), args.output.resolve()
    if not output.is_relative_to(ROOT):
        parser.error('输出文件必须在项目工作区内。')
    result = import_health(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    pending = output.with_suffix('.pending')
    pending.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if output.exists():
        shutil.copy2(output, output.with_suffix('.previous.json'))
    pending.replace(output)
    print(json.dumps({'days': len(result['daily']), 'records': result['rawRecordCount'],
                      'workouts': result['workoutCount'], 'metrics': list(result['metrics'])}))


if __name__ == '__main__':
    main()
