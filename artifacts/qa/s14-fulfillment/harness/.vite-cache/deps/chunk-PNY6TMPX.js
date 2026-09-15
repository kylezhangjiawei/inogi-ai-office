import {
  useControllableState
} from "./chunk-VQQDQQYF.js";
import {
  composeEventHandlers
} from "./chunk-463G74RZ.js";
import {
  Primitive
} from "./chunk-CBV5QQR3.js";
import {
  require_jsx_runtime
} from "./chunk-HZWFXBZR.js";
import {
  require_react
} from "./chunk-XISJ5XAA.js";
import {
  __toESM
} from "./chunk-LK32TJAX.js";

// node_modules/.pnpm/@radix-ui+react-toggle@1.1.2_@types+react-dom@18.3.7_@types+react@18.3.28__@types+react_0f2c34dc9ee8d1ae65e28293208a1bd1/node_modules/@radix-ui/react-toggle/dist/index.mjs
var React = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var NAME = "Toggle";
var Toggle = React.forwardRef((props, forwardedRef) => {
  const { pressed: pressedProp, defaultPressed = false, onPressedChange, ...buttonProps } = props;
  const [pressed = false, setPressed] = useControllableState({
    prop: pressedProp,
    onChange: onPressedChange,
    defaultProp: defaultPressed
  });
  return (0, import_jsx_runtime.jsx)(
    Primitive.button,
    {
      type: "button",
      "aria-pressed": pressed,
      "data-state": pressed ? "on" : "off",
      "data-disabled": props.disabled ? "" : void 0,
      ...buttonProps,
      ref: forwardedRef,
      onClick: composeEventHandlers(props.onClick, () => {
        if (!props.disabled) {
          setPressed(!pressed);
        }
      })
    }
  );
});
Toggle.displayName = NAME;
var Root = Toggle;

export {
  Toggle,
  Root
};
//# sourceMappingURL=chunk-PNY6TMPX.js.map
