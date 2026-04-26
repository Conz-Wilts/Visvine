const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo configuration
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];
config.resolver.unstable_enableSymlinks = true;

// CRITICAL: Restrict to native platforms only
// This prevents Metro from resolving 'react-native-web' modules
config.resolver.platforms = ['ios', 'android', 'native'];

// Use react-native field first, skip browser (web)
config.resolver.resolverMainFields = ['react-native', 'main'];

module.exports = config;