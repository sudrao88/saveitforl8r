/**
 * ESLint rule: no-raw-tailwind-colors
 *
 * Disallows raw Tailwind color/radius/duration/z-index classes in className attributes.
 * Use CSS custom property tokens from the design system instead.
 */

var TAILWIND_COLORS = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple', 'fuchsia',
  'pink', 'rose',
];

var COLOR_PREFIXES = [
  'bg', 'text', 'border', 'ring', 'outline',
  'shadow', 'from', 'to', 'via',
  'divide', 'accent', 'caret', 'fill', 'stroke',
  'decoration', 'placeholder',
];

// Match: prefix-color-shade with optional opacity
var colorPattern = new RegExp(
  '(?:^|\\s)(?:(?:hover|focus|active|disabled|group-hover|peer-hover|focus-within|focus-visible|dark|sm|md|lg|xl|2xl):)*(' +
  COLOR_PREFIXES.join('|') +
  ')-(' +
  TAILWIND_COLORS.join('|') +
  ')-(\\d+)(?:\\/\\d+)?(?:\\s|$)'
);

// Match text-white
var textWhitePattern = new RegExp('(?:^|\\s)(?:(?:hover|focus|active):)*text-white(?:\\s|$)');

// Arbitrary z-index: z-[number]
var arbitraryZPattern = new RegExp('z-\\[\\d+\\]');

// Arbitrary text size: text-[Npx]
var arbitraryTextSizePattern = new RegExp('text-\\[\\d+(?:px|rem|em)\\]');

// Raw border radius: rounded-sm, rounded-md, rounded-lg, rounded-xl, rounded-2xl, rounded-3xl
// (rounded-full and rounded-none are fine — no token needed)
var rawRadiusPattern = new RegExp('^(?:(?:hover|focus|active|sm|md|lg|xl|2xl):)*rounded-(sm|md|lg|xl|2xl|3xl)$');

// Raw duration: duration-100, duration-200, duration-300, etc.
var rawDurationPattern = new RegExp('^(?:(?:hover|focus|active|sm|md|lg|xl|2xl):)*duration-\\d+$');

// Raw numeric z-index: z-10, z-20, z-30, z-40, z-50
var rawZIndexPattern = new RegExp('^(?:(?:hover|focus|active|sm|md|lg|xl|2xl):)*z-\\d+$');

function checkStringForViolations(value, context, node) {
  var classes = value.split(/\s+/);

  for (var i = 0; i < classes.length; i++) {
    var cls = classes[i];
    // Need to add spaces for the boundary matching
    var padded = ' ' + cls + ' ';

    if (colorPattern.test(padded)) {
      context.report({
        node: node,
        message: 'Use a design system token instead of raw Tailwind color class "' + cls + '". See styles/design-system.ts and index.css @theme.',
      });
    }
    if (textWhitePattern.test(padded)) {
      context.report({
        node: node,
        message: 'Use text-(--color-text-primary) instead of "' + cls + '".',
      });
    }
    if (arbitraryZPattern.test(cls)) {
      context.report({
        node: node,
        message: 'Use a --z-* token instead of arbitrary z-index "' + cls + '".',
      });
    }
    if (arbitraryTextSizePattern.test(cls)) {
      context.report({
        node: node,
        message: 'Use a standard text size (text-xs, text-sm, etc.) instead of "' + cls + '".',
      });
    }
    if (rawRadiusPattern.test(cls)) {
      context.report({
        node: node,
        message: 'Use a --radius-* token (e.g. rounded-(--radius-lg)) instead of "' + cls + '". See index.css @theme.',
      });
    }
    if (rawDurationPattern.test(cls)) {
      context.report({
        node: node,
        message: 'Use a --duration-* token (e.g. duration-(--duration-fast)) instead of "' + cls + '". See index.css @theme.',
      });
    }
    if (rawZIndexPattern.test(cls)) {
      context.report({
        node: node,
        message: 'Use a --z-* token (e.g. z-(--z-sticky)) instead of "' + cls + '". See index.css @theme.',
      });
    }
  }
}

var rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow raw Tailwind color classes; use design system tokens instead',
    },
    messages: {},
    schema: [],
  },
  create: function(context) {
    return {
      JSXAttribute: function(node) {
        if (node.name.name !== 'className') return;

        var value = node.value;
        if (!value) return;

        // String literal: className="bg-gray-800 ..."
        if (value.type === 'Literal' && typeof value.value === 'string') {
          checkStringForViolations(value.value, context, node);
        }

        // JSX Expression container
        if (value.type === 'JSXExpressionContainer') {
          checkExpression(value.expression, context, node);
        }
      },
    };
  },
};

function checkExpression(expr, context, reportNode) {
  if (!expr) return;

  // Template literal
  if (expr.type === 'TemplateLiteral') {
    for (var i = 0; i < expr.quasis.length; i++) {
      var quasi = expr.quasis[i];
      if (quasi.value && quasi.value.raw) {
        checkStringForViolations(quasi.value.raw, context, reportNode);
      }
    }
    for (var j = 0; j < expr.expressions.length; j++) {
      checkExpression(expr.expressions[j], context, reportNode);
    }
  }

  // String literal in expression
  if (expr.type === 'Literal' && typeof expr.value === 'string') {
    checkStringForViolations(expr.value, context, reportNode);
  }

  // Conditional expression
  if (expr.type === 'ConditionalExpression') {
    checkExpression(expr.consequent, context, reportNode);
    checkExpression(expr.alternate, context, reportNode);
  }

  // Binary expression (string concat)
  if (expr.type === 'BinaryExpression' && expr.operator === '+') {
    checkExpression(expr.left, context, reportNode);
    checkExpression(expr.right, context, reportNode);
  }
}

export default rule;
