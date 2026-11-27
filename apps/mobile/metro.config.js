const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
const webcryptoShim = path.join(__dirname, "src/lib/webcrypto-shim.ts");
const resolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "isomorphic-webcrypto/src/react-native") return { type: "sourceFile", filePath: webcryptoShim };
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
