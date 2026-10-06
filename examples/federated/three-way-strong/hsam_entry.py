"""Use the same whole-flow timing convention as the Avg/CADS experiment."""
import argparse
from contextlib import nullcontext
from pathlib import Path
import sys
sys.path.insert(0, '/app')
import gfed_hsam_app

class FilesWithoutTiming:
    def input(self, path):
        return nullcontext(Path(path))
    def output(self, path):
        pass

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['init', 'train', 'aggregate', 'evaluate'])
    parser.add_argument('--input', default='/cea-work/in/global_model')
    parser.add_argument('--clients-manifest')
    parser.add_argument('--output', default='/cea-work/out/model.pt')
    gfed_hsam_app.run(parser.parse_args(), FilesWithoutTiming())
