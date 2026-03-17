const RULE_MAX_LENGTH = 500;
const ruleEvaluatorCache = new Map<string, any>();

function isPlainObject(value: any) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateExecutionDataAgainstSchema(inputSchema: any, data: any) {
  const errors: string[] = [];
  const payload = isPlainObject(data) ? data : {};

  if (!isPlainObject(inputSchema)) {
    return errors;
  }

  for (const [field, config] of Object.entries(inputSchema)) {
    const rule: any = config;
    const value = payload[field];
    const hasValue = value !== undefined && value !== null && value !== "";

    if (rule.required && !hasValue) {
      errors.push(`'${field}' is required`);
      continue;
    }

    if (!hasValue) {
      continue;
    }

    if (rule.type === "number" && typeof value !== "number") {
      errors.push(`'${field}' must be a number`);
    }

    if (rule.type === "string" && typeof value !== "string") {
      errors.push(`'${field}' must be a string`);
    }

    if (Array.isArray(rule.allowed_values) && !rule.allowed_values.includes(value)) {
      errors.push(`'${field}' must be one of: ${rule.allowed_values.join(", ")}`);
    }
  }

  return errors;
}

function normalizeCondition(condition: string) {
  return String(condition ?? "").trim();
}

function compileRuleEvaluator(condition: string) {
  const normalized = normalizeCondition(condition);

  if (ruleEvaluatorCache.has(normalized)) {
    return ruleEvaluatorCache.get(normalized);
  }

  const evaluator = new Function(
    "data",
    "contains",
    "startsWith",
    "endsWith",
    `with(data){ return (${normalized}); }`
  );

  ruleEvaluatorCache.set(normalized, evaluator);
  return evaluator;
}

function validateRuleConditionSyntax(condition: string) {
  const normalized = normalizeCondition(condition);

  if (!normalized) {
    return { valid: false, message: "Condition is required" };
  }

  if (normalized.toUpperCase() === "DEFAULT") {
    return { valid: true, message: null };
  }

  if (normalized.length > RULE_MAX_LENGTH) {
    return { valid: false, message: `Condition is too long (max ${RULE_MAX_LENGTH} characters)` };
  }

  if (/[`;\\]/.test(normalized)) {
    return { valid: false, message: "Condition contains disallowed characters" };
  }

  if (/\b(?:new|this|window|document|globalThis|Function|eval|require|process|constructor|prototype|__proto__)\b/i.test(normalized)) {
    return { valid: false, message: "Condition contains disallowed token" };
  }

  if (!/^[\w\s.$'"=!<>()&|,+\-*/%\[\]]+$/.test(normalized)) {
    return { valid: false, message: "Condition contains unsupported characters" };
  }

  const stack: string[] = [];
  const pairs: any = { ")": "(", "]": "[", "}": "{" };

  for (const char of normalized) {
    if (char === "(" || char === "[" || char === "{") {
      stack.push(char);
    }

    if (char === ")" || char === "]" || char === "}") {
      if (stack.pop() !== pairs[char]) {
        return { valid: false, message: "Condition has unbalanced brackets" };
      }
    }
  }

  if (stack.length > 0) {
    return { valid: false, message: "Condition has unbalanced brackets" };
  }

  try {
    compileRuleEvaluator(normalized);
  } catch (_error) {
    return { valid: false, message: "Condition has invalid expression syntax" };
  }

  return { valid: true, message: null };
}

function evaluateCondition(condition: string, data: any) {
  const normalized = normalizeCondition(condition);

  if (!normalized) {
    return { isValid: true, result: false, error: null };
  }

  if (normalized.toUpperCase() === "DEFAULT") {
    return { isValid: true, result: false, error: null };
  }

  const contains = (field: any, value: string) => String(field ?? "").includes(value);
  const startsWith = (field: any, prefix: string) => String(field ?? "").startsWith(prefix);
  const endsWith = (field: any, suffix: string) => String(field ?? "").endsWith(suffix);

  try {
    const evaluator = compileRuleEvaluator(normalized);

    return {
      isValid: true,
      result: Boolean(evaluator(data ?? {}, contains, startsWith, endsWith)),
      error: null
    };
  } catch (error) {
    return {
      isValid: false,
      result: false,
      error: error instanceof Error ? error.message : "Invalid condition"
    };
  }
}

module.exports = {
  RULE_MAX_LENGTH,
  isPlainObject,
  validateExecutionDataAgainstSchema,
  normalizeCondition,
  validateRuleConditionSyntax,
  evaluateCondition
};