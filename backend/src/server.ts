const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const app = express();
const frontendPath = path.join(__dirname, "../../frontend");
app.use(cors());
app.use(express.json());
app.use(express.static(frontendPath));
app.get("/health", (_req: any, res: any) => {
  res.json({ ok: true, message: "Backend running" });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
app.get("/", (_req: any, res: any) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});
const prisma = require("./lib/prisma");
const {
  isPlainObject,
  validateExecutionDataAgainstSchema,
  normalizeCondition,
  validateRuleConditionSyntax,
  evaluateCondition
} = require("./lib/ruleEngine");

const ALLOWED_STEP_TYPES = ["task", "approval", "notification"];
const DEFAULT_MAX_ITERATIONS = 100;
const DEMO_USERS = [
  { username: "employee", password: "employee123", role: "employee" },
  { username: "manager", password: "manager123", role: "manager" }
];
const activeSessions = new Map<string, { username: string; role: string }>();

function extractBearerToken(req: any) {
  const header = req.headers?.authorization;

  if (typeof header !== "string") {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  return typeof token === "string" ? token.trim() : null;
}

function requireAuth(req: any, res: any, next: any) {
  const token = extractBearerToken(req);

  if (!token) {
    return sendError(res, 401, "Unauthorized: missing bearer token");
  }

  const session = activeSessions.get(token);
  if (!session) {
    return sendError(res, 401, "Unauthorized: invalid or expired token");
  }

  req.authToken = token;
  req.authUser = session;
  next();
}

function requireRole(roles: string[]) {
  return (req: any, res: any, next: any) => {
    const role = req.authUser?.role;

    if (!roles.includes(role)) {
      return sendError(res, 403, `Forbidden: requires role ${roles.join(" or ")}`);
    }

    next();
  };
}

function getExecutionEndedAt(status: string) {
  if (status === "in_progress" || status === "pending_approval") {
    return null;
  }

  return new Date();
}

function formatOperatorNote(action: "Approved" | "Rejected", actor?: string, note?: string) {
  const normalizedActor = typeof actor === "string" && actor.trim() ? actor.trim() : "system";
  const normalizedNote = typeof note === "string" && note.trim() ? ` - ${note.trim()}` : "";
  return `${action} by: ${normalizedActor}${normalizedNote}`;
}

function sendError(res: any, status: number, message: string, details: any = null) {
  return res.status(status).json({
    message,
    details
  });
}

function validateWorkflowPayload(body: any, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      errors.push("'name' is required and must be a non-empty string");
    }
  }

  if (!partial || body.inputSchema !== undefined) {
    if (!isPlainObject(body.inputSchema)) {
      errors.push("'inputSchema' is required and must be a JSON object");
    }
  }

  if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
    errors.push("'description' must be a string or null");
  }

  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    errors.push("'isActive' must be a boolean");
  }

  if (body.startStepId !== undefined && body.startStepId !== null && typeof body.startStepId !== "string") {
    errors.push("'startStepId' must be a string or null");
  }

  return errors;
}

function validateStepPayload(body: any, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      errors.push("'name' is required and must be a non-empty string");
    }
  }

  if (!partial || body.stepType !== undefined) {
    if (!ALLOWED_STEP_TYPES.includes(body.stepType)) {
      errors.push("'stepType' must be one of: task, approval, notification");
    }
  }

  if (!partial || body.order !== undefined) {
    if (!Number.isInteger(body.order) || body.order < 1) {
      errors.push("'order' must be a positive integer");
    }
  }

  if (body.metadata !== undefined && body.metadata !== null && !isPlainObject(body.metadata)) {
    errors.push("'metadata' must be a JSON object or null");
  }

  return errors;
}

function validateRulePayload(body: any, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.condition !== undefined) {
    if (typeof body.condition !== "string" || !body.condition.trim()) {
      errors.push("'condition' is required and must be a non-empty string");
    }
  }

  if (body.nextStepId !== undefined && body.nextStepId !== null && typeof body.nextStepId !== "string") {
    errors.push("'nextStepId' must be a string or null");
  }

  if (!partial || body.priority !== undefined) {
    if (!Number.isInteger(body.priority) || body.priority < 1) {
      errors.push("'priority' must be a positive integer");
    }
  }

  return errors;
}

async function validateRuleReferences(
  stepId: string,
  condition: string,
  nextStepId: string | null,
  excludeRuleId: string | null = null
) {
  const errors: string[] = [];

  const step = await prisma.step.findUnique({
    where: { id: stepId }
  });

  if (!step) {
    errors.push("Step not found");
    return errors;
  }

  if (nextStepId) {
    if (nextStepId === stepId) {
      errors.push("'nextStepId' cannot point to the same step");
    }

    const nextStep = await prisma.step.findUnique({
      where: { id: nextStepId }
    });

    if (!nextStep) {
      errors.push("'nextStepId' must reference an existing step");
    } else if (nextStep.workflowId !== step.workflowId) {
      errors.push("'nextStepId' must belong to the same workflow");
    }
  }

  const normalized = normalizeCondition(condition);
  if (normalized.toUpperCase() === "DEFAULT") {
    const existingRules = await prisma.rule.findMany({
      where: { stepId }
    });

    const duplicateDefault = existingRules.find((rule: any) => {
      if (excludeRuleId && rule.id === excludeRuleId) {
        return false;
      }

      return normalizeCondition(rule.condition).toUpperCase() === "DEFAULT";
    });

    if (duplicateDefault) {
      errors.push("Only one DEFAULT rule is allowed per step");
    }
  }

  return errors;
}

function validateExecutionPayload(body: any) {
  const errors = [];

  if (body.data !== undefined && !isPlainObject(body.data)) {
    errors.push("'data' must be a JSON object");
  }

  if (body.triggeredBy !== undefined && body.triggeredBy !== null && typeof body.triggeredBy !== "string") {
    errors.push("'triggeredBy' must be a string or null");
  }

  if (body.maxIterations !== undefined && (!Number.isInteger(body.maxIterations) || body.maxIterations < 1)) {
    errors.push("'maxIterations' must be a positive integer");
  }

  return errors;
}

async function triggerNotification(executionId: string, step: any, data: any) {
  try {
    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionId,
          stepName: step.name,
          stepType: step.stepType,
          timestamp: new Date().toISOString(),
          data
        })
      }).catch(() => {});
    }
  } catch (err) {
    console.error("Notification failed silently:", err);
  }
}

async function runExecutionFromStep(
  executionId: string,
  startStepId: string,
  data: any,
  maxIterations: number
) {
  let currentStepId = startStepId;
  let iterationCount = 0;

  while (currentStepId && iterationCount < maxIterations) {
    iterationCount += 1;
    const stepStartAt = new Date();

    const step = await prisma.step.findUnique({
      where: { id: currentStepId },
      include: {
        rules: {
          orderBy: { priority: "asc" }
        }
      }
    });

    if (!step) {
      await prisma.executionLog.create({
        data: {
          executionId,
          stepId: currentStepId,
          status: "failed",
          errorMessage: "Step not found",
          startedAt: stepStartAt,
          endedAt: new Date(),
          durationMs: new Date().getTime() - stepStartAt.getTime()
        }
      });

      return {
        status: "failed",
        currentStepId
      };
    }

    // Handle approval steps - pause execution
    if (step.stepType === "approval") {
      await prisma.executionLog.create({
        data: {
          executionId,
          stepId: step.id,
          stepName: step.name,
          stepType: step.stepType,
          status: "pending_approval",
          startedAt: stepStartAt,
          endedAt: new Date(),
          durationMs: new Date().getTime() - stepStartAt.getTime()
        }
      });

      // Update execution to pending approval
      await prisma.execution.update({
        where: { id: executionId },
        data: {
          status: "pending_approval",
          currentStepId: step.id
        }
      });

      return {
        status: "pending_approval",
        currentStepId: step.id,
        message: "Execution paused at approval step"
      };
    }

    // Handle notification steps
    if (step.stepType === "notification") {
      await triggerNotification(executionId, step, data);
      
      await prisma.executionLog.create({
        data: {
          executionId,
          stepId: step.id,
          stepName: step.name,
          stepType: step.stepType,
          status: "completed",
          startedAt: stepStartAt,
          endedAt: new Date(),
          durationMs: new Date().getTime() - stepStartAt.getTime()
        }
      });

      // Auto-advance to default next step for notifications
      const defaultRule = step.rules.find((rule: any) => rule.condition.toUpperCase() === "DEFAULT");
      if (defaultRule?.nextStepId) {
        currentStepId = defaultRule.nextStepId;
        continue;
      }

      return {
        status: "completed",
        currentStepId: null
      };
    }

    // Handle task steps - evaluate rules
    const evaluatedRules: any[] = [];
    let matchedRule: any = null;
    const defaultRule = step.rules.find((rule: any) => rule.condition.toUpperCase() === "DEFAULT");

    for (const rule of step.rules) {
      if (rule.condition.toUpperCase() === "DEFAULT") {
        continue;
      }

      const evaluation = evaluateCondition(rule.condition, data);
      evaluatedRules.push({
        ruleId: rule.id,
        condition: rule.condition,
        priority: rule.priority,
        nextStepId: rule.nextStepId,
        result: evaluation.result,
        isValid: evaluation.isValid,
        error: evaluation.error
      });

      if (!evaluation.isValid) {
        await prisma.executionLog.create({
          data: {
            executionId,
            stepId: step.id,
            stepName: step.name,
            stepType: step.stepType,
            evaluatedRules,
            status: "failed",
            errorMessage: `Invalid rule syntax: ${evaluation.error}`,
            startedAt: stepStartAt,
            endedAt: new Date(),
            durationMs: new Date().getTime() - stepStartAt.getTime()
          }
        });

        return {
          status: "failed",
          currentStepId: step.id
        };
      }

      if (evaluation.result) {
        matchedRule = rule;
        break;
      }
    }

    if (!matchedRule && defaultRule) {
      evaluatedRules.push({
        ruleId: defaultRule.id,
        condition: defaultRule.condition,
        priority: defaultRule.priority,
        nextStepId: defaultRule.nextStepId,
        result: true,
        isDefault: true
      });
      matchedRule = defaultRule;
    }

    if (!matchedRule) {
      await prisma.executionLog.create({
        data: {
          executionId,
          stepId: step.id,
          stepName: step.name,
          stepType: step.stepType,
          evaluatedRules,
          status: "failed",
          errorMessage: "No rule matched and DEFAULT rule missing",
          startedAt: stepStartAt,
          endedAt: new Date(),
          durationMs: new Date().getTime() - stepStartAt.getTime()
        }
      });

      return {
        status: "failed",
        currentStepId: step.id
      };
    }

    await prisma.executionLog.create({
      data: {
        executionId,
        stepId: step.id,
        stepName: step.name,
        stepType: step.stepType,
        evaluatedRules,
        selectedNextStep: matchedRule.nextStepId,
        status: "completed",
        startedAt: stepStartAt,
        endedAt: new Date(),
        durationMs: new Date().getTime() - stepStartAt.getTime()
      }
    });

    if (!matchedRule.nextStepId) {
      return {
        status: "completed",
        currentStepId: null
      };
    }

    currentStepId = matchedRule.nextStepId;
  }

  if (iterationCount >= maxIterations) {
    await prisma.executionLog.create({
      data: {
        executionId,
        stepId: currentStepId,
        status: "failed",
        errorMessage: `Max iterations (${maxIterations}) reached`,
        startedAt: new Date(),
        endedAt: new Date(),
        durationMs: 0
      }
    });

    return {
      status: "failed",
      currentStepId
    };
  }

  return {
    status: "completed",
    currentStepId: null
  };
}

async function getExecutionWithLogs(executionId: string) {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId }
  });

  if (!execution) {
    return null;
  }

  const logs = await prisma.executionLog.findMany({
    where: { executionId },
    orderBy: { createdAt: "asc" }
  });

  return {
    ...execution,
    logs
  };
}

app.post("/auth/login", (req: any, res: any) => {
  const { username, password } = req.body ?? {};
  const normalizedUsername = typeof username === "string" ? username.trim() : "";
  const normalizedPassword = typeof password === "string" ? password : "";

  if (!normalizedUsername || !normalizedPassword) {
    return sendError(res, 400, "Username and password are required");
  }

  const user = DEMO_USERS.find(
    (candidate) => candidate.username === normalizedUsername && candidate.password === normalizedPassword
  );

  if (!user) {
    return sendError(res, 401, "Invalid credentials");
  }

  const token = Buffer.from(`${user.username}:${Date.now()}:${Math.random()}`).toString("base64url");
  activeSessions.set(token, { username: user.username, role: user.role });

  res.json({
    token,
    user: {
      username: user.username,
      role: user.role
    }
  });
});

app.get("/auth/me", requireAuth, (req: any, res: any) => {
  res.json({ user: req.authUser });
});

app.post("/auth/logout", requireAuth, (req: any, res: any) => {
  activeSessions.delete(req.authToken);
  res.status(204).send();
});

app.use("/workflows", requireAuth);
app.use("/steps", requireAuth);
app.use("/rules", requireAuth);
app.use("/executions", requireAuth);
app.use("/config", requireAuth);

app.post("/workflows", async (req: any, res: any) => {
  try {
    const { name, description, inputSchema } = req.body;
    const errors = validateWorkflowPayload(req.body);

    if (errors.length > 0) {
      return sendError(res, 400, "Invalid workflow payload", errors);
    }

    const workflow = await prisma.workflow.create({
      data: {
        name: name.trim(),
        description,
        inputSchema
      }
    });
    res.status(201).json(workflow);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to create workflow");
  }
});
app.get("/workflows", async (_req: any, res: any) => {
  try {
    const page = Math.max(Number(_req.query.page ?? 1) || 1, 1);
    const limit = Math.min(Math.max(Number(_req.query.limit ?? 10) || 10, 1), 100);
    const search = typeof _req.query.search === "string" ? _req.query.search.trim() : "";

    const where = search
      ? {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } }
          ]
        }
      : undefined;

    const total = await prisma.workflow.count({ where });
    const workflows = await prisma.workflow.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    });

    res.json({
      items: workflows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch workflows" });
  }
});

app.get("/workflows/:id", async (req: any, res: any) => {
  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id },
      include: {
        steps: {
          orderBy: { order: "asc" },
          include: {
            rules: {
              orderBy: { priority: "asc" }
            }
          }
        }
      }
    });

    if (!workflow) {
      return sendError(res, 404, "Workflow not found");
    }

    res.json(workflow);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to fetch workflow");
  }
});

app.put("/workflows/:id", async (req: any, res: any) => {
  try {
    const existingWorkflow = await prisma.workflow.findUnique({
      where: { id: req.params.id }
    });

    if (!existingWorkflow) {
      return sendError(res, 404, "Workflow not found");
    }

    const errors = validateWorkflowPayload(req.body, { partial: true });

    if (errors.length > 0) {
      return sendError(res, 400, "Invalid workflow payload", errors);
    }

    const { name, description, inputSchema, isActive, startStepId } = req.body;

    const updatedWorkflow = await prisma.workflow.update({
      where: { id: req.params.id },
      data: {
        name: typeof name === "string" ? name.trim() : existingWorkflow.name,
        description: description ?? existingWorkflow.description,
        inputSchema: inputSchema ?? existingWorkflow.inputSchema,
        isActive: isActive ?? existingWorkflow.isActive,
        startStepId: startStepId ?? existingWorkflow.startStepId,
        version: existingWorkflow.version + 1
      }
    });

    res.json(updatedWorkflow);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to update workflow");
  }
});

app.delete("/workflows/:id", async (req: any, res: any) => {
  try {
    const existingWorkflow = await prisma.workflow.findUnique({
      where: { id: req.params.id }
    });

    if (!existingWorkflow) {
      return sendError(res, 404, "Workflow not found");
    }

    await prisma.workflow.delete({
      where: { id: req.params.id }
    });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to delete workflow");
  }
});

app.post("/workflows/:workflowId/steps", async (req: any, res: any) => {
  try {
    const { workflowId } = req.params;
    const { name, stepType, order, metadata } = req.body;
    const errors = validateStepPayload(req.body);

    if (errors.length > 0) {
      return sendError(res, 400, "Invalid step payload", errors);
    }

    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      return sendError(res, 404, "Workflow not found");
    }

    const step = await prisma.step.create({
      data: {
        workflowId,
        name: name.trim(),
        stepType,
        order,
        metadata
      }
    });

    res.status(201).json(step);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to create step");
  }
});

app.get("/workflows/:workflowId/steps", async (req: any, res: any) => {
  try {
    const { workflowId } = req.params;

    const steps = await prisma.step.findMany({
      where: { workflowId },
      orderBy: { order: "asc" }
    });

    res.json(steps);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to fetch steps");
  }
});

app.put("/steps/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { name, stepType, order, metadata } = req.body;

    const existingStep = await prisma.step.findUnique({
      where: { id }
    });

    if (!existingStep) {
      return sendError(res, 404, "Step not found");
    }

    const errors = validateStepPayload(req.body, { partial: true });

    if (errors.length > 0) {
      return sendError(res, 400, "Invalid step payload", errors);
    }

    const updatedStep = await prisma.step.update({
      where: { id },
      data: {
        name: typeof name === "string" ? name.trim() : existingStep.name,
        stepType: stepType ?? existingStep.stepType,
        order: order ?? existingStep.order,
        metadata: metadata ?? existingStep.metadata
      }
    });

    res.json(updatedStep);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to update step");
  }
});

app.delete("/steps/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const existingStep = await prisma.step.findUnique({
      where: { id }
    });

    if (!existingStep) {
      return sendError(res, 404, "Step not found");
    }

    await prisma.step.delete({
      where: { id }
    });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to delete step");
  }
});

app.post("/steps/:stepId/rules", async (req: any, res: any) => {
  try {
    const { stepId } = req.params;
    const { condition, nextStepId, priority } = req.body;
    const errors = validateRulePayload(req.body);

    if (errors.length > 0) {
      return sendError(res, 400, "Invalid rule payload", errors);
    }

    const normalizedCondition = normalizeCondition(condition);
    const syntaxValidation = validateRuleConditionSyntax(normalizedCondition);

    if (!syntaxValidation.valid) {
      return sendError(res, 400, "Invalid rule condition", [syntaxValidation.message]);
    }

    const referenceErrors = await validateRuleReferences(
      stepId,
      normalizedCondition,
      nextStepId ?? null
    );

    if (referenceErrors.length > 0) {
      const statusCode = referenceErrors.includes("Step not found") ? 404 : 400;
      return sendError(res, statusCode, "Invalid rule references", referenceErrors);
    }

    const rule = await prisma.rule.create({
      data: {
        stepId,
        condition: normalizedCondition.toUpperCase() === "DEFAULT" ? "DEFAULT" : normalizedCondition,
        nextStepId,
        priority
      }
    });

    res.status(201).json(rule);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to create rule");
  }
});

app.get("/steps/:stepId/rules", async (req: any, res: any) => {
  try {
    const { stepId } = req.params;

    const rules = await prisma.rule.findMany({
      where: { stepId },
      orderBy: { priority: "asc" }
    });

    res.json(rules);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to fetch rules");
  }
});

app.put("/rules/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { condition, nextStepId, priority } = req.body;

    const existingRule = await prisma.rule.findUnique({
      where: { id }
    });

    if (!existingRule) {
      return sendError(res, 404, "Rule not found");
    }

    const errors = validateRulePayload(req.body, { partial: true });

    if (errors.length > 0) {
      return sendError(res, 400, "Invalid rule payload", errors);
    }

    const resolvedCondition = typeof condition === "string"
      ? normalizeCondition(condition)
      : existingRule.condition;
    const resolvedNextStepId = nextStepId ?? existingRule.nextStepId;

    const syntaxValidation = validateRuleConditionSyntax(resolvedCondition);
    if (!syntaxValidation.valid) {
      return sendError(res, 400, "Invalid rule condition", [syntaxValidation.message]);
    }

    const referenceErrors = await validateRuleReferences(
      existingRule.stepId,
      resolvedCondition,
      resolvedNextStepId,
      id
    );

    if (referenceErrors.length > 0) {
      const statusCode = referenceErrors.includes("Step not found") ? 404 : 400;
      return sendError(res, statusCode, "Invalid rule references", referenceErrors);
    }

    const updatedRule = await prisma.rule.update({
      where: { id },
      data: {
        condition: resolvedCondition.toUpperCase() === "DEFAULT" ? "DEFAULT" : resolvedCondition,
        nextStepId: resolvedNextStepId,
        priority: priority ?? existingRule.priority
      }
    });

    res.json(updatedRule);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to update rule");
  }
});

app.delete("/rules/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const existingRule = await prisma.rule.findUnique({
      where: { id }
    });

    if (!existingRule) {
      return sendError(res, 404, "Rule not found");
    }

    await prisma.rule.delete({
      where: { id }
    });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to delete rule");
  }
});

app.post("/workflows/:workflowId/execute", requireRole(["employee"]), async (req: any, res: any) => {
  try {
    const { workflowId } = req.params;
    const { data, triggeredBy, maxIterations } = req.body;
    const errors = validateExecutionPayload(req.body);

    if (errors.length > 0) {
      return sendError(res, 400, "Invalid execution payload", errors);
    }

    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      return sendError(res, 404, "Workflow not found");
    }

    const dataValidationErrors = validateExecutionDataAgainstSchema(workflow.inputSchema, data ?? {});

    if (dataValidationErrors.length > 0) {
      return sendError(res, 400, "Execution data does not match workflow input schema", dataValidationErrors);
    }

    const steps = await prisma.step.findMany({
      where: { workflowId },
      orderBy: { order: "asc" }
    });

    const firstStepId = workflow.startStepId ?? steps[0]?.id;

    if (!firstStepId) {
      return sendError(res, 400, "Workflow has no start step");
    }

    const execution = await prisma.execution.create({
      data: {
        workflowId,
        workflowVersion: workflow.version,
        status: "in_progress",
        data: data ?? {},
        currentStepId: firstStepId,
        triggeredBy: req.authUser?.username ?? triggeredBy ?? null
      }
    });

    const result = await runExecutionFromStep(
      execution.id,
      firstStepId,
      data ?? {},
      Number(maxIterations ?? DEFAULT_MAX_ITERATIONS)
    );

    const finalizedExecution = await prisma.execution.update({
      where: { id: execution.id },
      data: {
        status: result.status,
        currentStepId: result.currentStepId,
        endedAt: getExecutionEndedAt(result.status)
      }
    });

    const logs = await prisma.executionLog.findMany({
      where: { executionId: execution.id },
      orderBy: { createdAt: "asc" }
    });

    res.status(201).json({
      ...finalizedExecution,
      logs
    });
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to execute workflow");
  }
});

app.get("/executions", async (_req: any, res: any) => {
  try {
    const executions = await prisma.execution.findMany({
      orderBy: { createdAt: "desc" }
    });

    res.json(executions);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to fetch executions");
  }
});

app.get("/executions/:id", async (req: any, res: any) => {
  try {
    const execution = await getExecutionWithLogs(req.params.id);

    if (!execution) {
      return sendError(res, 404, "Execution not found");
    }

    res.json(execution);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to fetch execution");
  }
});

app.post("/executions/:id/cancel", requireRole(["manager"]), async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const execution = await prisma.execution.findUnique({
      where: { id }
    });

    if (!execution) {
      return sendError(res, 404, "Execution not found");
    }

    if (["completed", "failed", "canceled"].includes(execution.status)) {
      return sendError(res, 400, `Cannot cancel execution in '${execution.status}' state`);
    }

    const canceledExecution = await prisma.execution.update({
      where: { id },
      data: {
        status: "canceled",
        endedAt: new Date()
      }
    });

    res.json(canceledExecution);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to cancel execution");
  }
});

app.post("/executions/:id/retry", requireRole(["manager"]), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { maxIterations } = req.body;

    if (maxIterations !== undefined && (!Number.isInteger(maxIterations) || maxIterations < 1)) {
      return sendError(res, 400, "Invalid retry payload", ["'maxIterations' must be a positive integer"]);
    }

    const execution = await prisma.execution.findUnique({
      where: { id }
    });

    if (!execution) {
      return sendError(res, 404, "Execution not found");
    }

    if (execution.status !== "failed") {
      return sendError(res, 400, "Only failed executions can be retried");
    }

    const failedLog = await prisma.executionLog.findFirst({
      where: {
        executionId: id,
        status: "failed",
        stepId: { not: null }
      },
      orderBy: { createdAt: "desc" }
    });

    if (!failedLog?.stepId) {
      return sendError(res, 400, "No failed step found to retry");
    }

    await prisma.execution.update({
      where: { id },
      data: {
        status: "in_progress",
        retries: execution.retries + 1,
        currentStepId: failedLog.stepId,
        endedAt: null
      }
    });

    const result = await runExecutionFromStep(
      id,
      failedLog.stepId,
      execution.data,
      Number(maxIterations ?? DEFAULT_MAX_ITERATIONS)
    );

    await prisma.execution.update({
      where: { id },
      data: {
        status: result.status,
        currentStepId: result.currentStepId,
        endedAt: getExecutionEndedAt(result.status)
      }
    });

    const finalExecution = await getExecutionWithLogs(id);
    res.json(finalExecution);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to retry execution");
  }
});

// Approval Endpoint - Resume execution from pending approval
app.post("/executions/:id/approve", requireRole(["manager"]), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { approvedBy, comment, maxIterations } = req.body;
    const operator = req.authUser?.username ?? approvedBy;

    if (maxIterations !== undefined && (!Number.isInteger(maxIterations) || maxIterations < 1)) {
      return sendError(res, 400, "Invalid approve payload", ["'maxIterations' must be a positive integer"]);
    }

    const execution = await prisma.execution.findUnique({
      where: { id }
    });

    if (!execution) {
      return sendError(res, 404, "Execution not found");
    }

    if (execution.status !== "pending_approval") {
      return sendError(res, 400, `Cannot approve execution in '${execution.status}' state`);
    }

    // Log approval
    await prisma.executionLog.create({
      data: {
        executionId: id,
        status: "approved",
        errorMessage: formatOperatorNote("Approved", operator, comment)
      }
    });

    // Resume execution from the approval step
    const currentStep = await prisma.step.findUnique({
      where: { id: execution.currentStepId || "" },
      include: {
        rules: {
          orderBy: { priority: "asc" }
        }
      }
    });

    if (!currentStep) {
      return sendError(res, 400, "Current approval step not found");
    }

    const defaultRule = currentStep?.rules?.find((r: any) => r.condition.toUpperCase() === "DEFAULT");
    const nextStepId = defaultRule?.nextStepId || null;

    if (nextStepId) {
      const result = await runExecutionFromStep(
        id,
        nextStepId,
        execution.data,
        Number(maxIterations ?? DEFAULT_MAX_ITERATIONS)
      );

      await prisma.execution.update({
        where: { id },
        data: {
          status: result.status,
          currentStepId: result.currentStepId,
          endedAt: getExecutionEndedAt(result.status)
        }
      });
    } else {
      // No next step, mark as completed
      await prisma.execution.update({
        where: { id },
        data: {
          status: "completed",
          currentStepId: null,
          endedAt: new Date()
        }
      });
    }

    const finalExecution = await getExecutionWithLogs(id);
    res.json(finalExecution);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to approve execution");
  }
});

// Reject Endpoint - Reject pending approval
app.post("/executions/:id/reject", requireRole(["manager"]), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { rejectedBy, reason } = req.body;
    const operator = req.authUser?.username ?? rejectedBy;

    const execution = await prisma.execution.findUnique({
      where: { id }
    });

    if (!execution) {
      return sendError(res, 404, "Execution not found");
    }

    if (execution.status !== "pending_approval") {
      return sendError(res, 400, `Cannot reject execution in '${execution.status}' state`);
    }

    await prisma.executionLog.create({
      data: {
        executionId: id,
        status: "rejected",
        errorMessage: formatOperatorNote("Rejected", operator, reason ? `Reason: ${reason}` : "")
      }
    });

    await prisma.execution.update({
      where: { id },
      data: {
        status: "failed",
        endedAt: new Date()
      }
    });

    const finalExecution = await getExecutionWithLogs(id);
    res.json(finalExecution);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to reject execution");
  }
});

// Execution Summary - Statistics and timing
app.get("/executions/:id/summary", async (req: any, res: any) => {
  try {
    const execution = await getExecutionWithLogs(req.params.id);

    if (!execution) {
      return sendError(res, 404, "Execution not found");
    }

    const logs = execution.logs || [];
    const totalDuration = logs.reduce((sum: number, log: any) => sum + (log.durationMs || 0), 0);
    const stepCount = logs.length;
    const failedSteps = logs.filter((l: any) => l.status === "failed").length;
    const completedSteps = logs.filter((l: any) => l.status === "completed").length;

    res.json({
      id: execution.id,
      workflowId: execution.workflowId,
      status: execution.status,
      stepCount,
      completedSteps,
      failedSteps,
      totalDurationMs: totalDuration,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt,
      retries: execution.retries
    });
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to fetch execution summary");
  }
});

// Webhook Configuration - For notifications
app.post("/config/webhook", async (req: any, res: any) => {
  try {
    const { url, events } = req.body;

    if (!url || typeof url !== "string") {
      return sendError(res, 400, "Invalid webhook configuration", ["'url' is required and must be a string"]);
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return sendError(res, 400, "Invalid webhook URL", ["'url' must be a valid URL"]);
    }

    // Store in env or config (in production, use a dedicated config service)
    process.env.NOTIFICATION_WEBHOOK_URL = url;

    res.status(201).json({
      message: "Webhook configured successfully",
      url,
      events: events || ["all"]
    });
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to configure webhook");
  }
});

// Get Webhook Configuration
app.get("/config/webhook", async (_req: any, res: any) => {
  try {
    res.json({
      url: process.env.NOTIFICATION_WEBHOOK_URL || null,
      configured: !!process.env.NOTIFICATION_WEBHOOK_URL
    });
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to fetch webhook configuration");
  }
});

