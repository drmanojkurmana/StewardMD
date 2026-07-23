#!/bin/bash
exec > >(tee -a ~/run.log) 2>&1
set -o pipefail
cd ~
echo "===== V4 MASTER RUN start $(date -u) ====="
[ -n "$PY" ] || { [ -x /opt/conda/bin/python ] && PY=/opt/conda/bin/python || PY=$(command -v python3); }
echo "python=$PY"
$PY -c "import torch;print('torch',torch.__version__,'cuda',torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
pip install -q timm wfdb scikit-learn matplotlib pillow 2>&1 | tail -2
echo "===== 1. labels (corrected: STTC superclass via scp_statements, LAD dropped -> 18 classes) ====="
[ -f ptbxl_database.csv ] || curl -sL -o ptbxl_database.csv https://physionet.org/files/ptb-xl/1.0.3/ptbxl_database.csv
[ -f scp_statements.csv ] || curl -sL -o scp_statements.csv https://physionet.org/files/ptb-xl/1.0.3/scp_statements.csv
$PY build_labels.py --ptbxl_csv ptbxl_database.csv --scp_csv scp_statements.csv --out labels.csv
echo "===== 2. multi-layout render (${LIMIT:-17000} records) ====="
$PY render.py --labels labels.csv --out images --limit ${LIMIT:-17000} --workers ${WORKERS:-14}
echo "===== 3. train v4 (heavy photo-aug + temperature calibration + operating metrics + v2 head-to-head) ====="
$PY train_v2.py --labels labels.csv --img_dir images --epochs ${EPOCHS:-16} --bs ${BS:-48} --out image_model_v4.pt --backbone efficientnet_b3 --v2 image_model_v2.pt
echo "===== V4 MASTER RUN done $(date -u) ====="
