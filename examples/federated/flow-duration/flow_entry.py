"""Experiment-only CLI: original algorithm, without whole-file timing collection.

The workflow's real startedAt/endedAt are the metric. No substitute SDK report
is produced. Business exceptions from app.run still fail the task.
"""
import argparse
from contextlib import nullcontext
from pathlib import Path
import sys

sys.path.insert(0, '/app')
import app


class FilesWithoutTiming:
    def input(self, path):
        return nullcontext(Path(path))

    def output(self, path):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['init', 'train', 'aggregate', 'evaluate'])
    parser.add_argument('--input', default='/cea-work/in/global_model')
    parser.add_argument('--clients-manifest')
    parser.add_argument('--output', default='/cea-work/out/model.pt')
    app.run(parser.parse_args(), FilesWithoutTiming())


if __name__ == '__main__':
    main()
