#!/bin/bash
set -e
cd ~
sudo apt-get update -qq && sudo apt-get install -y -qq python3-venv python3-pip >/dev/null 2>&1
python3 -m venv ~/venv
~/venv/bin/pip install -q --upgrade pip >/dev/null 2>&1
~/venv/bin/pip install -q torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cpu
~/venv/bin/pip install -q timm==1.0.9 wfdb scikit-learn matplotlib pillow numpy
export PY=~/venv/bin/python
nohup bash master_run_v2.sh > ~/run.log 2>&1 &
echo "LAUNCHED master_run_v2.sh pid $!"
