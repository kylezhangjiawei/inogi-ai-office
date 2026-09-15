import {
  Primitive
} from "./chunk-CBV5QQR3.js";
import "./chunk-TIHEY36E.js";
import "./chunk-OOX777YS.js";
import {
  require_jsx_runtime
} from "./chunk-HZWFXBZR.js";
import {
  require_react
} from "./chunk-XISJ5XAA.js";
import {
  __toESM
} from "./chunk-LK32TJAX.js";

// node_modules/.pnpm/@radix-ui+react-separator@1.1.2_@types+react-dom@18.3.7_@types+react@18.3.28__@types+re_7fa23d2ac89aaad94e9c81b741c80e70/node_modules/@radix-ui/react-separator/dist/index.mjs
var React = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var NAME = "Separator";
var DEFAULT_ORIENTATION = "horizontal";
var ORIENTATIONS = ["horizontal", "vertical"];
var Separator = React.forwardRef((props, forwardedRef) => {
  const { decorative, orientation: orientationProp = DEFAULT_ORIENTATION, ...domProps } = props;
  const orientation = isValidOrientation(orientationProp) ? orientationProp : DEFAULT_ORIENTATION;
  const ariaOrientation = orientation === "vertical" ? orientation : void 0;
  const semanticProps = decorative ? { role: "none" } : { "aria-orientation": ariaOrientation, role: "separator" };
  return (0, import_jsx_runtime.jsx)(
    Primitive.div,
    {
      "data-orientation": orientation,
      ...semanticProps,
      ...domProps,
      ref: forwardedRef
    }
  );
});
Separator.displayName = NAME;
function isValidOrientation(orientation) {
  return ORIENTATIONS.includes(orientation);
}
var Root = Separator;
export {
  Root,
  Separator
};
//# sourceMappingURL=@radix-ui_react-separator.js.map
