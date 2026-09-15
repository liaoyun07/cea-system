"""Test-only entrypoint. Original algorithm, file handling and SDK are reused unchanged."""
import model
from bulk_loader import bulk_training_loader

model.DataLoader = bulk_training_loader
from app import main

if __name__ == '__main__':
    main()
