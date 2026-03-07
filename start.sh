#!/bin/sh
# claude-mobile — auto-start for a-Shell on iPad

# Check if ~Documents bookmark exists by trying to cd to it
cd ~Documents 2>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠ First run: you need to grant iCloud access."
    echo "Run: pickFolder"
    echo "Then select: iCloud Drive → Documents"
    echo "Then run this script again: sh start.sh"
    exit 1
fi

cd ~Documents/../Hub/dev/claude-mobile

echo "Starting claude-mobile..."
python3 claude-mobile.py
