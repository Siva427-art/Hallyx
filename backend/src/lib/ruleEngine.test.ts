const {
  evaluateCondition,
  normalizeCondition,
  validateExecutionDataAgainstSchema,
  validateRuleConditionSyntax
} = require("./ruleEngine");

describe("ruleEngine", () => {
  it("accepts DEFAULT condition", () => {
    const result = validateRuleConditionSyntax("DEFAULT");
    expect(result.valid).toBe(true);
  });

  it("rejects disallowed token", () => {
    const result = validateRuleConditionSyntax("process.exit(1)");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("Condition contains disallowed token");
  });

  it("rejects unbalanced brackets", () => {
    const result = validateRuleConditionSyntax("amount > 100 && (country == 'US'");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("Condition has unbalanced brackets");
  });

  it("evaluates helper functions in condition", () => {
    const output = evaluateCondition("contains(country, 'U') && startsWith(priority, 'Hi')", {
      country: "US",
      priority: "High"
    });

    expect(output.isValid).toBe(true);
    expect(output.result).toBe(true);
  });

  it("returns false for DEFAULT evaluation path", () => {
    const output = evaluateCondition("DEFAULT", { amount: 100 });
    expect(output.isValid).toBe(true);
    expect(output.result).toBe(false);
  });

  it("normalizes whitespace in conditions", () => {
    expect(normalizeCondition("  amount > 10  ")).toBe("amount > 10");
  });

  it("validates payload against schema", () => {
    const errors = validateExecutionDataAgainstSchema(
      {
        amount: { type: "number", required: true },
        country: { type: "string", required: true, allowed_values: ["US", "IN"] },
        priority: { type: "string", required: false, allowed_values: ["High", "Low"] }
      },
      {
        amount: "250",
        country: "UK",
        priority: "Medium"
      }
    );

    expect(errors).toContain("'amount' must be a number");
    expect(errors).toContain("'country' must be one of: US, IN");
    expect(errors).toContain("'priority' must be one of: High, Low");
  });

  it("evaluates complex branching conditions", () => {
    const output = evaluateCondition("amount > 1000 && country == 'US' || priority == 'High'", {
      amount: 500,
      country: "US",
      priority: "High"
    });

    expect(output.isValid).toBe(true);
    expect(output.result).toBe(true);
  });

  it("handles numeric comparisons correctly", () => {
    const output = evaluateCondition("amount >= 100 && amount <= 500", {
      amount: 250
    });

    expect(output.isValid).toBe(true);
    expect(output.result).toBe(true);
  });

  it("handles string matching functions", () => {
    const output = evaluateCondition("endsWith(email, '@company.com') && contains(name, 'John')", {
      email: "john.doe@company.com",
      name: "John Doe"
    });

    expect(output.isValid).toBe(true);
    expect(output.result).toBe(true);
  });

  it("rejects invalid function calls", () => {
    const result = validateRuleConditionSyntax("eval(data)");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("Condition contains disallowed token");
  });
});