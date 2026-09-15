import {
  require_jsx_runtime
} from "./chunk-HZWFXBZR.js";
import {
  require_react
} from "./chunk-XISJ5XAA.js";
import {
  __toESM
} from "./chunk-LK32TJAX.js";

// node_modules/.pnpm/@radix-ui+react-direction@1.1.0_@types+react@18.3.28_react@18.3.1/node_modules/@radix-ui/react-direction/dist/index.mjs
var React = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var DirectionContext = React.createContext(void 0);
function useDirection(localDir) {
  const globalDir = React.useContext(DirectionContext);
  return localDir || globalDir || "ltr";
}

export {
  useDirection
};
//# sourceMappingURL=chunk-O26QUKKW.js.map
