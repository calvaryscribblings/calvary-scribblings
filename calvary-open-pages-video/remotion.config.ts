import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// Concurrency auto-detects from available cores; override with --concurrency if needed
