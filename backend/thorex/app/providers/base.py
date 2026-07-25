from abc import ABC, abstractmethod
from dataclasses import dataclass
import numpy as np

@dataclass
class PreparedImage:
    array: np.ndarray      # normalized 224x224 float32 for local models
    outbound_png: bytes    # de-identified full-res PNG for third-party transmission

class InferenceProvider(ABC):
    name: str = "base"
    educational: bool = False

    @abstractmethod
    def detect(self, prepared: "PreparedImage") -> list[tuple[str, float]]:
        """Return list of (label, probability[0..1]). No thresholding here."""
        raise NotImplementedError
