def pytest_configure(config):
    config.addinivalue_line("markers", "models: real model weights (slow, downloads).")
