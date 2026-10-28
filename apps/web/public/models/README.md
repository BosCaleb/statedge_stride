# Self-hosted pose model files

This folder is filled by `pnpm fetch-models` and is not committed (except this file).

- `pose_landmarker_full-f16-v1.task`, and `pose_landmarker_heavy-f16-v1.task` with `--heavy`:
  MediaPipe Pose Landmarker models (Apache 2.0), pinned by URL and SHA-256 in
  `apps/web/src/analysis-runtime/models.json`.
- `tasks-vision-<version>/`: the MediaPipe Tasks Vision WASM runtime, copied from
  `node_modules/@mediapipe/tasks-vision/wasm`.

File names carry versions, so a new model is a new URL and the `models-v1` runtime cache never
serves a stale file. Change the model by editing models.json (URL, checksum, file name).
