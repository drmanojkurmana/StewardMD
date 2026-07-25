from app.providers.base import InferenceProvider

class MockProvider(InferenceProvider):
    def __init__(self, name: str = "mock", educational: bool = False):
        self.name = name
        self.educational = educational
    def detect(self, prepared=None) -> list[tuple[str, float]]:
        return [("Pneumonia", 0.72), ("Effusion", 0.41), ("Cardiomegaly", 0.18)]
