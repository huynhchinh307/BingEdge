"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Platform = exports.HashAlgorithm = exports.Architecture = void 0;
var Architecture;
(function (Architecture) {
    Architecture["Arm64"] = "arm64";
    Architecture["Universal"] = "universal";
    Architecture["X64"] = "x64";
    Architecture["X86"] = "x86";
})(Architecture || (exports.Architecture = Architecture = {}));
var HashAlgorithm;
(function (HashAlgorithm) {
    HashAlgorithm["Sha256"] = "SHA256";
})(HashAlgorithm || (exports.HashAlgorithm = HashAlgorithm = {}));
var Platform;
(function (Platform) {
    Platform["Android"] = "Android";
    Platform["IOS"] = "iOS";
    Platform["Linux"] = "Linux";
    Platform["MACOS"] = "MacOS";
    Platform["Windows"] = "Windows";
})(Platform || (exports.Platform = Platform = {}));
//# sourceMappingURL=UserAgentUtil.js.map