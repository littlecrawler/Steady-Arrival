import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('health_importer', ROOT / 'scripts' / 'import_apple_health.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HealthImportTests(unittest.TestCase):
    def parse(self, records):
        folder = ROOT / 'tests' / '.tmp'
        folder.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=folder) as temp:
            file = Path(temp) / 'synthetic.xml'
            file.write_text('<HealthData>' + records + '</HealthData>', encoding='utf-8')
            return module.import_health(file)

    def record(self, kind, value, unit='', source='Synthetic device', start='2026-01-01 12:00:00 +0800', end='2026-01-01 12:10:00 +0800'):
        return '<Record type="' + kind + '" value="' + value + '" unit="' + unit + '" sourceName="' + source + '" startDate="' + start + '" endDate="' + end + '"/>'

    def test_dedup_and_source_selection_do_not_add_phone_and_watch(self):
        prefix = 'HKQuantityTypeIdentifierStepCount'
        sample = self.record(prefix, '100', 'count')
        result = self.parse(sample + sample + self.record(prefix, '70', 'count', source='Another device'))
        self.assertEqual(result['daily'][0]['steps'], 100)
        self.assertEqual(result['skipped']['exactDuplicates'], 1)

    def test_in_bed_is_not_sleep_and_midnight_is_split(self):
        kind = 'HKCategoryTypeIdentifierSleepAnalysis'
        result = self.parse(self.record(kind, 'HKCategoryValueSleepAnalysisInBed',
            start='2026-01-01 23:00:00 +0800', end='2026-01-02 07:00:00 +0800'))
        self.assertEqual([d['inBedHours'] for d in result['daily']], [1, 7])
        self.assertTrue(all('sleepHours' not in d for d in result['daily']))

    def test_sleep_overlap_is_union_and_percent_is_fraction(self):
        kind = 'HKCategoryTypeIdentifierSleepAnalysis'
        a = self.record(kind, 'HKCategoryValueSleepAnalysisAsleep', start='2026-01-01 01:00:00 +0800', end='2026-01-01 03:00:00 +0800')
        b = self.record(kind, 'HKCategoryValueSleepAnalysisAsleepCore', start='2026-01-01 02:00:00 +0800', end='2026-01-01 04:00:00 +0800')
        c = self.record('HKQuantityTypeIdentifierBodyFatPercentage', '0.25', '%')
        result = self.parse(a + b + c)
        self.assertEqual(result['daily'][0]['sleepHours'], 3)
        self.assertEqual(result['daily'][0]['bodyFatPct'], 25)

    def test_latest_measurement_unknown_units_and_zero(self):
        a = self.record('HKQuantityTypeIdentifierBodyMass', '75', 'kg')
        b = self.record('HKQuantityTypeIdentifierBodyMass', '74', 'kg', start='2026-01-01 13:00:00 +0800', end='2026-01-01 13:00:00 +0800')
        c = self.record('HKQuantityTypeIdentifierStepCount', '0', 'count')
        d = self.record('HKQuantityTypeIdentifierActiveEnergyBurned', '10', 'unknown')
        result = self.parse(a + b + c + d)
        self.assertEqual(result['daily'][0]['weightKg'], 74)
        self.assertEqual(result['daily'][0]['steps'], 0)
        self.assertNotIn('activeKcal', result['daily'][0])
        self.assertEqual(result['skipped']['unsupportedUnits'], 1)


if __name__ == '__main__':
    unittest.main()
