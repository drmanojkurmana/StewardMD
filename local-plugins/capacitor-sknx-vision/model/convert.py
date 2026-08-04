# Convert the SknX experimental dermatology classifier ONNX -> Core ML (.mlpackage).
#
# Source model: Robobyte/skin-cancer-mobilenet-v3 (HAM10000, 7-class MobileNetV3, ImageNet norm, 224x224,
#   class order akiec,bcc,bkl,df,mel,nv,vasc). EXPERIMENTAL / uncalibrated - the SknX guardrail decides.
#
#   curl -L -o skin_cancer_model.onnx \
#     https://huggingface.co/Robobyte/skin-cancer-mobilenet-v3/resolve/main/skin_cancer_model.onnx
#   python3 -m venv v && ./v/bin/pip install coremltools onnx onnx2torch torch
#   ./v/bin/python convert.py            # -> DermMobileNetV3.mlpackage
#
# Then host the 3 files under the base URL the plugin fetches (default
# https://models.stewardmd.in/sknx/derm-mnv3), preserving structure:
#   <base>/Manifest.json
#   <base>/Data/com.apple.CoreML/model.mlmodel
#   <base>/Data/com.apple.CoreML/weights/weight.bin
#
# The output already applies softmax (Wrap below), so the plugin reads probabilities directly. Input is
# a plain [1,3,224,224] Float32 tensor (the plugin does the resize + ImageNet normalize in Swift, matching
# sknx-realvision.js). Verified: coremltools 9, input "input", output "var_650" [1,7], ~8 MB .mlpackage.
import onnx2torch, torch, onnx
import coremltools as ct

net = onnx2torch.convert(onnx.load("skin_cancer_model.onnx")).eval()

class Wrap(torch.nn.Module):
    def __init__(self, net): super().__init__(); self.net = net
    def forward(self, x): return torch.softmax(self.net(x), dim=-1)

w = Wrap(net).eval()
traced = torch.jit.trace(w, torch.rand(1, 3, 224, 224))
mlmodel = ct.convert(
    traced,
    inputs=[ct.TensorType(name="input", shape=(1, 3, 224, 224))],
    convert_to="mlprogram",
    minimum_deployment_target=ct.target.iOS15,
)
mlmodel.save("DermMobileNetV3.mlpackage")
print("SAVED DermMobileNetV3.mlpackage")
