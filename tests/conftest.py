import os
import tempfile

os.environ["LMU_DATA_DIR"] = tempfile.mkdtemp(prefix="lmu-test-")
