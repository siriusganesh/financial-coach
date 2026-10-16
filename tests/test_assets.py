"""Generated copies must match their source."""
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Generated(unittest.TestCase):
    def test_research_ts_matches_reference(self):
        spec = importlib.util.spec_from_file_location("gen", ROOT / "scripts" / "gen_research.py")
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        got = (ROOT / "supabase" / "functions" / "coach" / "research.ts").read_text()
        self.assertEqual(got, gen.render(), "Run: python3 scripts/gen_research.py")


if __name__ == "__main__":
    unittest.main()
