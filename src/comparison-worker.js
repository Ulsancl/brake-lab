import { compareAbs } from './model.js';

self.onmessage = ({ data: settings }) => {
  try {
    self.postMessage({ comparison: compareAbs(settings) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
