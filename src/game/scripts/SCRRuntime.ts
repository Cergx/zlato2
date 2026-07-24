export type SCRValue = number | string | boolean;

export interface SCRSourceLocation {
    readonly offset: number;
    readonly line: number;
    readonly column: number;
}

export interface SCRSourceRange {
    readonly start: SCRSourceLocation;
    readonly end: SCRSourceLocation;
}

export type SCRTokenKind = "identifier" | "number" | "string" | "operator" | "punctuation" | "eof";

export interface SCRToken extends SCRSourceRange {
    readonly kind: SCRTokenKind;
    readonly text: string;
    readonly value?: number | string;
}

export interface SCRParseLimits {
    readonly maxSourceLength: number;
    readonly maxTokens: number;
    readonly maxNestingDepth: number;
}

export interface SCRExecutionLimits extends SCRParseLimits {
    readonly maxSteps: number;
}

export const DEFAULT_SCR_PARSE_LIMITS: SCRParseLimits = {
    maxSourceLength: 512 * 1024,
    maxTokens: 32_768,
    maxNestingDepth: 128,
};

export const DEFAULT_SCR_EXECUTION_LIMITS: SCRExecutionLimits = {
    ...DEFAULT_SCR_PARSE_LIMITS,
    maxSteps: 100_000,
};

export class SCRRuntimeError extends Error {
    readonly sourceName: string;
    readonly location: SCRSourceLocation;

    constructor(sourceName: string, location: SCRSourceLocation, message: string) {
        super(`${sourceName}:${location.line}:${location.column}: ${message}`);
        this.name = "SCRRuntimeError";
        this.sourceName = sourceName;
        this.location = location;
    }
}

export type SCRExpression =
    | SCRLiteralExpression
    | SCRVariableExpression
    | SCRCallExpression
    | SCRUnaryExpression
    | SCRBinaryExpression;

export interface SCRLiteralExpression extends SCRSourceRange {
    readonly type: "literal";
    readonly value: number | string;
}

export interface SCRVariableExpression extends SCRSourceRange {
    readonly type: "variable";
    readonly name: string;
}

export interface SCRCallExpression extends SCRSourceRange {
    readonly type: "call";
    readonly name: string;
    readonly arguments: readonly SCRExpression[];
}

export interface SCRUnaryExpression extends SCRSourceRange {
    readonly type: "unary";
    readonly operator: "!" | "+" | "-";
    readonly operand: SCRExpression;
}

export interface SCRBinaryExpression extends SCRSourceRange {
    readonly type: "binary";
    readonly operator: "||" | "&&" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "%";
    readonly left: SCRExpression;
    readonly right: SCRExpression;
}

export type SCRStatement = SCRDeclarationStatement | SCRAssignmentStatement | SCRExpressionStatement | SCRBlockStatement | SCRIfStatement;

export interface SCRDeclarationStatement extends SCRSourceRange {
    readonly type: "declaration";
    readonly name: string;
    readonly initialValue: SCRExpression;
}

export interface SCRAssignmentStatement extends SCRSourceRange {
    readonly type: "assignment";
    readonly name: string;
    readonly expression: SCRExpression;
}

export interface SCRExpressionStatement extends SCRSourceRange {
    readonly type: "expression";
    readonly expression: SCRExpression;
}

export interface SCRBlockStatement extends SCRSourceRange {
    readonly type: "block";
    readonly statements: readonly SCRStatement[];
}

export interface SCRIfStatement extends SCRSourceRange {
    readonly type: "if";
    readonly condition: SCRExpression;
    readonly consequent: SCRStatement;
    readonly alternate?: SCRStatement;
}

export interface SCRProgram {
    readonly type: "program";
    readonly sourceName: string;
    readonly statements: readonly SCRStatement[];
}

export type SCRHostCall = (name: string, arguments_: readonly SCRValue[]) => SCRValue | undefined;

/** Host function dispatcher. Function names passed to this method are normalized to lower case. */
export interface SCRHost {
    call: SCRHostCall;
}

export interface SCRRuntimeOptions {
    readonly host?: SCRHost;
    readonly variables?: Readonly<Record<string, SCRValue>> | Iterable<readonly [string, SCRValue]>;
    readonly limits?: Partial<SCRExecutionLimits>;
}

export interface SCRExecutionResult {
    readonly steps: number;
}

const DECLARATION_KEYWORDS: Readonly<Record<string, true>> = {
    int: true,
    float: true,
    string: true,
    bool: true,
};

const UNSUPPORTED_KEYWORDS: Readonly<Record<string, true>> = {
    void: true,
    while: true,
    for: true,
    return: true,
    switch: true,
    case: true,
    break: true,
    continue: true,
};
const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
    "||": 1,
    "&&": 2,
    "==": 3,
    "!=": 3,
    "<": 4,
    "<=": 4,
    ">": 4,

    ">=": 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
    "%": 6,
};

export type SCREventHandlerName = "OnEnter" | "OnHover" | "OnLeave" | "OnClick";

/** Returns the body of a top-level trigger handler, preserving source text for the normal parser. */
export const extractSCREventHandler = (source: string, handler: SCREventHandlerName): string | undefined => {
    const header = new RegExp(`^\\s*${handler}\\s*$`, "m").exec(source);
    if (!header) return undefined;
    let cursor = header.index + header[0].length;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
    if (source[cursor] !== "{") throw new Error(`SCR handler ${handler} is missing its opening brace`);
    const bodyStart = ++cursor;
    let depth = 1;
    let quote = "";
    while (cursor < source.length) {
        const character = source[cursor];
        if (quote) {
            if (character === "\\") cursor++;
            else if (character === quote) quote = "";
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === "{") {
            depth++;
        } else if (character === "}" && --depth === 0) {
            return source.slice(bodyStart, cursor);
        }
        cursor++;
    }
    throw new Error(`SCR handler ${handler} is missing its closing brace`);
};

export const normalizeSCRIdentifier = (identifier: string): string => identifier.toLowerCase();

const mergeParseLimits = (overrides: Partial<SCRParseLimits> | undefined, base = DEFAULT_SCR_PARSE_LIMITS): SCRParseLimits => ({
    maxSourceLength: overrides?.maxSourceLength ?? base.maxSourceLength,
    maxTokens: overrides?.maxTokens ?? base.maxTokens,
    maxNestingDepth: overrides?.maxNestingDepth ?? base.maxNestingDepth,
});

const mergeExecutionLimits = (overrides: Partial<SCRExecutionLimits> | undefined, base = DEFAULT_SCR_EXECUTION_LIMITS): SCRExecutionLimits => ({
    ...mergeParseLimits(overrides, base),
    maxSteps: overrides?.maxSteps ?? base.maxSteps,
});

const assertPositiveInteger = (value: number, name: string): void => {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
};

const validateParseLimits = (limits: SCRParseLimits): void => {
    assertPositiveInteger(limits.maxSourceLength, "maxSourceLength");
    assertPositiveInteger(limits.maxTokens, "maxTokens");
    assertPositiveInteger(limits.maxNestingDepth, "maxNestingDepth");
};

const validateExecutionLimits = (limits: SCRExecutionLimits): void => {
    validateParseLimits(limits);
    assertPositiveInteger(limits.maxSteps, "maxSteps");
};

const isIdentifierStart = (character: string): boolean => /[A-Za-z_]/.test(character);
const isIdentifierPart = (character: string): boolean => /[A-Za-z0-9_]/.test(character);
const isDigit = (character: string): boolean => /[0-9]/.test(character);

class Lexer {
    private offset = 0;
    private line = 1;
    private column = 1;
    private readonly tokens: SCRToken[] = [];

    constructor(
        private readonly source: string,
        private readonly sourceName: string,
        private readonly limits: SCRParseLimits,
    ) {}

    tokenize(): readonly SCRToken[] {
        if (this.source.length > this.limits.maxSourceLength) {
            throw this.error(this.location(), `Source exceeds ${this.limits.maxSourceLength} character limit`);
        }

        while (!this.atEnd()) {
            this.skipWhitespaceAndComments();
            if (this.atEnd()) {
                break;
            }

            const start = this.location();
            const character = this.current();
            if (isIdentifierStart(character)) {
                this.identifier(start);
            } else if (isDigit(character)) {
                this.number(start);
            } else if (character === "\"") {
                this.string(start);
            } else {
                this.symbol(start);
            }
        }

        this.add({ kind: "eof", text: "", start: this.location(), end: this.location() });
        return this.tokens;
    }

    private skipWhitespaceAndComments(): void {
        for (;;) {
            while (!this.atEnd() && /\s/.test(this.current())) {
                this.advance();
            }
            if (this.current() !== "/" || this.atEnd(1)) {
                return;
            }
            if (this.peek() === "/") {
                while (!this.atEnd() && this.current() !== "\n") {
                    this.advance();
                }
                continue;
            }
            if (this.peek() === "*") {
                const start = this.location();
                this.advance();
                this.advance();
                while (!this.atEnd() && !(this.current() === "*" && this.peek() === "/")) {
                    this.advance();
                }
                if (this.atEnd()) {
                    throw this.error(start, "Unterminated block comment");
                }
                this.advance();
                this.advance();
                continue;
            }
            return;
        }
    }

    private identifier(start: SCRSourceLocation): void {
        const offset = this.offset;
        this.advance();
        while (!this.atEnd() && isIdentifierPart(this.current())) {
            this.advance();
        }
        this.add({ kind: "identifier", text: this.source.slice(offset, this.offset), start, end: this.location() });
    }

    private number(start: SCRSourceLocation): void {
        const offset = this.offset;
        while (!this.atEnd() && isDigit(this.current())) {
            this.advance();
        }
        if (this.current() === ".") {
            this.advance();
            if (this.atEnd() || !isDigit(this.current())) {
                throw this.error(start, "Expected a digit after decimal point");
            }
            while (!this.atEnd() && isDigit(this.current())) {
                this.advance();
            }
        }
        if (this.current() === "e" || this.current() === "E") {
            this.advance();
            if (this.current() === "+" || this.current() === "-") {
                this.advance();
            }
            if (this.atEnd() || !isDigit(this.current())) {
                throw this.error(start, "Invalid exponent in number literal");
            }
            while (!this.atEnd() && isDigit(this.current())) {
                this.advance();
            }
        }
        const text = this.source.slice(offset, this.offset);
        const value = Number(text);
        if (!Number.isFinite(value)) {
            throw this.error(start, `Invalid number literal '${text}'`);
        }
        this.add({ kind: "number", text, value, start, end: this.location() });
    }

    private string(start: SCRSourceLocation): void {
        this.advance();
        let value = "";
        while (!this.atEnd() && this.current() !== "\"") {
            if (this.current() === "\n" || this.current() === "\r") {
                throw this.error(start, "Unterminated string literal");
            }
            if (this.current() !== "\\") {
                value += this.current();
                this.advance();
                continue;
            }

            this.advance();
            if (this.atEnd()) {
                throw this.error(start, "Unterminated string escape");
            }
            const escaped = this.current();
            const escapeValues: Readonly<Record<string, string>> = {
                "\"": "\"",
                "\\": "\\",
                n: "\n",
                r: "\r",
                t: "\t",
                0: "\0",
            };
            const escape = escapeValues[escaped];
            value += escape ?? `\\${escaped}`;
            this.advance();
        }
        if (this.atEnd()) {
            throw this.error(start, "Unterminated string literal");
        }
        this.advance();
        this.add({ kind: "string", text: this.source.slice(start.offset, this.offset), value, start, end: this.location() });
    }

    private symbol(start: SCRSourceLocation): void {
        const twoCharacterOperator = `${this.current()}${this.peek()}`;
        if (["==", "!=", "<=", ">=", "&&", "||"].includes(twoCharacterOperator)) {
            this.advance();
            this.advance();
            this.add({ kind: "operator", text: twoCharacterOperator, start, end: this.location() });
            return;
        }
        const character = this.current();
        if (["=", "!", "+", "-", "*", "/", "%", "<", ">"].includes(character)) {
            this.advance();
            this.add({ kind: "operator", text: character, start, end: this.location() });
            return;
        }
        if (["(", ")", "{", "}", ";", ","].includes(character)) {
            this.advance();
            this.add({ kind: "punctuation", text: character, start, end: this.location() });
            return;
        }
        throw this.error(start, `Unsupported character '${character}'`);
    }

    private add(token: SCRToken): void {
        if (this.tokens.length >= this.limits.maxTokens) {
            throw this.error(token.start, `Token limit of ${this.limits.maxTokens} exceeded`);
        }
        this.tokens.push(token);
    }

    private atEnd(lookahead = 0): boolean {
        return this.offset + lookahead >= this.source.length;
    }

    private current(): string {
        return this.source[this.offset] ?? "";
    }

    private peek(): string {
        return this.source[this.offset + 1] ?? "";
    }

    private advance(): void {
        if (this.current() === "\r" && this.peek() === "\n") {
            this.offset += 2;
            this.line += 1;
            this.column = 1;
            return;
        }
        if (this.current() === "\n" || this.current() === "\r") {
            this.line += 1;
            this.column = 1;
        } else {
            this.column += 1;
        }
        this.offset += 1;
    }

    private location(): SCRSourceLocation {
        return { offset: this.offset, line: this.line, column: this.column };
    }

    private error(location: SCRSourceLocation, message: string): SCRRuntimeError {
        return new SCRRuntimeError(this.sourceName, location, message);
    }
}

class Parser {
    private index = 0;
    private nestingDepth = 0;

    constructor(
        private readonly tokens: readonly SCRToken[],
        private readonly sourceName: string,
        private readonly limits: SCRParseLimits,
    ) {}

    parseProgram(): SCRProgram {
        const statements: SCRStatement[] = [];
        while (!this.isAtEnd()) {
            statements.push(this.statement());
        }
        return { type: "program", sourceName: this.sourceName, statements };
    }

    private statement(): SCRStatement {
        const token = this.current();
        if (token.kind === "identifier" && this.next().kind === "operator" && this.next().text === "=") {
            const name = this.advance();
            this.advance();
            const expression = this.expression();
            const semicolon = this.current().kind === "punctuation" && this.current().text === ";"
                ? this.advance()
                : this.isIdentifier(name, "if") && this.current().kind === "punctuation" && this.current().text === "{"
                    ? { end: expression.end } as SCRToken
                    : this.expectPunctuation(";", "Expected ';' after assignment");
            return { type: "assignment", name: name.text, expression, start: name.start, end: semicolon.end };
        }
        if (this.isIdentifier(token, "if")) {
            return this.ifStatement();
        }
        if (this.isIdentifier(token, "else")) {
            throw this.error(token, "Unexpected 'else'");
        }
        if (token.kind === "punctuation" && token.text === "{") {
            return this.blockStatement();
        }
        if (token.kind === "identifier" && DECLARATION_KEYWORDS[normalizeSCRIdentifier(token.text)] === true) {
            return this.declarationStatement();
        }
        if (token.kind === "identifier" && UNSUPPORTED_KEYWORDS[normalizeSCRIdentifier(token.text)] === true) {
            throw this.error(token, `Unsupported SCR syntax '${token.text}'`);
        }
        const expression = this.expression();
        const semicolon = this.expectPunctuation(";", "Expected ';' after expression");
        return { type: "expression", expression, start: expression.start, end: semicolon.end };
    }

    private declarationStatement(): SCRDeclarationStatement {
        const declaration = this.advance();
        const name = this.current();
        if (name.kind !== "identifier") throw this.error(name, `Expected variable name after '${declaration.text}'`);
        this.advance();
        let initialValue: SCRExpression = {
            type: "literal",
            value: normalizeSCRIdentifier(declaration.text) === "string" ? "" : 0,
            start: name.start,
            end: name.end,
        };
        if (this.current().kind === "operator" && this.current().text === "=") {
            this.advance();
            initialValue = this.expression();
        }
        const semicolon = this.expectPunctuation(";", "Expected ';' after declaration");
        return { type: "declaration", name: name.text, initialValue, start: declaration.start, end: semicolon.end };
    }

    private ifStatement(): SCRIfStatement {
        const start = this.advance().start;
        this.expectPunctuation("(", "Expected '(' after if");
        const condition = this.expression();
        this.expectPunctuation(")", "Expected ')' after if condition");
        const consequent = this.nested(() => this.statement());
        let alternate: SCRStatement | undefined;
        if (this.isIdentifier(this.current(), "else")) {
            this.advance();
            alternate = this.nested(() => this.statement());
        }
        return { type: "if", condition, consequent, alternate, start, end: (alternate ?? consequent).end };
    }

    private blockStatement(): SCRBlockStatement {
        const start = this.expectPunctuation("{", "Expected '{'").start;
        const statements: SCRStatement[] = [];
        this.nestingDepth += 1;
        if (this.nestingDepth > this.limits.maxNestingDepth) {
            throw this.error(this.current(), `Nesting limit of ${this.limits.maxNestingDepth} exceeded`);
        }
        try {
            while (!this.isAtEnd() && !(this.current().kind === "punctuation" && this.current().text === "}")) {
                statements.push(this.statement());
            }
            const end = this.expectPunctuation("}", "Expected '}' to close block").end;
            return { type: "block", statements, start, end };
        } finally {
            this.nestingDepth -= 1;
        }
    }

    private expression(minimumPrecedence = 1): SCRExpression {
        let left = this.unary();
        for (;;) {
            const operator = this.current();
            const precedence = operator.kind === "operator" ? BINARY_PRECEDENCE[operator.text] : undefined;
            if (precedence === undefined || precedence < minimumPrecedence) {
                return left;
            }
            this.advance();
            const right = this.expression(precedence + 1);
            left = {
                type: "binary",
                operator: operator.text as SCRBinaryExpression["operator"],
                left,
                right,
                start: left.start,
                end: right.end,
            };
        }
    }

    private unary(): SCRExpression {
        const token = this.current();
        if (token.kind === "operator" && (token.text === "!" || token.text === "+" || token.text === "-")) {
            this.advance();
            const operand = this.unary();
            return { type: "unary", operator: token.text, operand, start: token.start, end: operand.end };
        }
        return this.primary();
    }

    private primary(): SCRExpression {
        const token = this.current();
        if (token.kind === "number" || token.kind === "string") {
            this.advance();
            return { type: "literal", value: token.value as number | string, start: token.start, end: token.end };
        }
        if (token.kind === "identifier") {
            this.advance();
            if (!(this.current().kind === "punctuation" && this.current().text === "(")) {
                return { type: "variable", name: token.text, start: token.start, end: token.end };
            }
            this.advance();
            const arguments_: SCRExpression[] = [];
            if (!(this.current().kind === "punctuation" && this.current().text === ")")) {
                arguments_.push(this.expression());
                while (this.current().kind === "punctuation" && this.current().text === ",") {
                    this.advance();
                    arguments_.push(this.expression());
                }
            }
            const end = this.expectPunctuation(")", "Expected ')' after function arguments").end;
            return { type: "call", name: token.text, arguments: arguments_, start: token.start, end };
        }
        if (token.kind === "punctuation" && token.text === "(") {
            this.advance();
            const expression = this.nested(() => this.expression());
            this.expectPunctuation(")", "Expected ')' after expression");
            return expression;
        }
        throw this.error(token, `Expected expression, found '${token.text || "end of file"}'`);
    }

    private nested<T>(callback: () => T): T {
        this.nestingDepth += 1;
        if (this.nestingDepth > this.limits.maxNestingDepth) {
            throw this.error(this.current(), `Nesting limit of ${this.limits.maxNestingDepth} exceeded`);
        }
        try {
            return callback();
        } finally {
            this.nestingDepth -= 1;
        }
    }

    private expectPunctuation(value: string, message: string): SCRToken {
        const token = this.current();
        if (token.kind !== "punctuation" || token.text !== value) {
            throw this.error(token, message);
        }
        return this.advance();
    }

    private isIdentifier(token: SCRToken, identifier: string): boolean {
        return token.kind === "identifier" && normalizeSCRIdentifier(token.text) === identifier;
    }

    private current(): SCRToken {
        return this.tokens[this.index] as SCRToken;
    }

    private next(): SCRToken {
        return this.tokens[this.index + 1] ?? this.current();
    }

    private advance(): SCRToken {
        const token = this.current();
        if (!this.isAtEnd()) {
            this.index += 1;
        }
        return token;
    }

    private isAtEnd(): boolean {
        return this.current().kind === "eof";
    }

    private error(token: SCRToken, message: string): SCRRuntimeError {
        return new SCRRuntimeError(this.sourceName, token.start, message);
    }
}

export const lexSCR = (source: string, sourceName = "script", overrides?: Partial<SCRParseLimits>): readonly SCRToken[] => {
    const limits = mergeParseLimits(overrides);
    validateParseLimits(limits);
    return new Lexer(source, sourceName, limits).tokenize();
};

export const parseSCR = (source: string, sourceName = "script", overrides?: Partial<SCRParseLimits>): SCRProgram => {
    const limits = mergeParseLimits(overrides);
    validateParseLimits(limits);
    return new Parser(lexSCR(source, sourceName, limits), sourceName, limits).parseProgram();
};

const isSCRValue = (value: unknown): value is SCRValue =>
    typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

const isTruthy = (value: SCRValue): boolean => value !== false && value !== 0 && value !== "";

interface ExecutionState {
    readonly sourceName: string;
    readonly limits: SCRExecutionLimits;
    steps: number;
}

export class SCRRuntime {
    private readonly persistentVariables = new Map<string, SCRValue>();
    private readonly host: SCRHost | undefined;
    private readonly limits: SCRExecutionLimits;

    constructor(options: SCRRuntimeOptions = {}) {
        this.host = options.host;
        this.limits = mergeExecutionLimits(options.limits);
        validateExecutionLimits(this.limits);
        if (options.variables !== undefined) {
            if (Symbol.iterator in Object(options.variables)) {
                for (const [name, value] of options.variables as Iterable<readonly [string, SCRValue]>) {
                    this.setVariable(name, value);
                }
            } else {
                for (const [name, value] of Object.entries(options.variables)) {
                    this.setVariable(name, value);
                }
            }
        }
    }

    getVariable(name: string): SCRValue | undefined {
        return this.persistentVariables.get(normalizeSCRIdentifier(name));
    }

    hasVariable(name: string): boolean {
        return this.persistentVariables.has(normalizeSCRIdentifier(name));
    }

    setVariable(name: string, value: SCRValue): void {
        if (!isSCRValue(value)) {
            throw new TypeError("SCR variables must be finite numbers, strings, or booleans");
        }
        this.persistentVariables.set(normalizeSCRIdentifier(name), value);
    }

    clearVariables(): void {
        this.persistentVariables.clear();
    }

    variableEntries(): readonly (readonly [string, SCRValue])[] {
        return [...this.persistentVariables.entries()];
    }

    execute(source: string, sourceName = "script", overrides?: Partial<SCRExecutionLimits>): SCRExecutionResult {
        const limits = mergeExecutionLimits(overrides, this.limits);
        validateExecutionLimits(limits);
        return this.executeProgram(parseSCR(source, sourceName, limits), limits);
    }

    executeProgram(program: SCRProgram, overrides?: Partial<SCRExecutionLimits>): SCRExecutionResult {
        const limits = mergeExecutionLimits(overrides, this.limits);
        validateExecutionLimits(limits);
        const state: ExecutionState = { sourceName: program.sourceName, steps: 0, limits };
        for (const statement of program.statements) {
            this.evaluateStatement(statement, state);
        }
        return { steps: state.steps };
    }

    private evaluateStatement(statement: SCRStatement, state: ExecutionState): void {
        this.step(statement.start, state);
        switch (statement.type) {
            case "declaration":
                this.setVariable(statement.name, this.evaluateExpression(statement.initialValue, state));
                return;
            case "assignment":
                this.setVariable(statement.name, this.evaluateExpression(statement.expression, state));
                return;
            case "expression":
                this.evaluateExpression(statement.expression, state);
                return;
            case "block":
                for (const nestedStatement of statement.statements) {
                    this.evaluateStatement(nestedStatement, state);
                }
                return;
            case "if":
                if (isTruthy(this.evaluateExpression(statement.condition, state))) {
                    this.evaluateStatement(statement.consequent, state);
                } else if (statement.alternate !== undefined) {
                    this.evaluateStatement(statement.alternate, state);
                }
                return;
        }
    }

    private evaluateExpression(expression: SCRExpression, state: ExecutionState): SCRValue {
        this.step(expression.start, state);
        switch (expression.type) {
            case "literal":
                return expression.value;
            case "variable":
                return this.getVariable(expression.name) ?? 0;
            case "call":
                return this.callHost(expression, state);
            case "unary":
                return this.evaluateUnary(expression, state);
            case "binary":
                return this.evaluateBinary(expression, state);
        }
    }

    private callHost(expression: SCRCallExpression, state: ExecutionState): SCRValue {
        if (this.host === undefined) {
            throw this.error(state.sourceName, expression.start, `No host is configured for function '${expression.name}'`);
        }
        const arguments_ = expression.arguments.map((argument) => this.evaluateExpression(argument, state));
        try {
            const result = this.host.call(normalizeSCRIdentifier(expression.name), arguments_);
            if (result === undefined) {
                return 0;
            }
            if (!isSCRValue(result)) {
                throw new TypeError("host functions must return a finite number, string, boolean, or undefined");
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw this.error(state.sourceName, expression.start, `Host call '${expression.name}' failed: ${message}`);
        }
    }

    private evaluateUnary(expression: SCRUnaryExpression, state: ExecutionState): SCRValue {
        const value = this.evaluateExpression(expression.operand, state);
        switch (expression.operator) {
            case "!":
                return isTruthy(value) ? 0 : 1;
            case "+":
                return this.numeric(value, expression.start, state);
            case "-":
                return -this.numeric(value, expression.start, state);
        }
    }

    private evaluateBinary(expression: SCRBinaryExpression, state: ExecutionState): SCRValue {
        if (expression.operator === "&&") {
            const left = this.evaluateExpression(expression.left, state);
            return isTruthy(left) && isTruthy(this.evaluateExpression(expression.right, state)) ? 1 : 0;
        }
        if (expression.operator === "||") {
            const left = this.evaluateExpression(expression.left, state);
            return isTruthy(left) || isTruthy(this.evaluateExpression(expression.right, state)) ? 1 : 0;
        }

        const left = this.evaluateExpression(expression.left, state);
        const right = this.evaluateExpression(expression.right, state);
        switch (expression.operator) {
            case "==":
                return left === right ? 1 : 0;
            case "!=":
                return left !== right ? 1 : 0;
            case "<":
                return this.numeric(left, expression.left.start, state) < this.numeric(right, expression.right.start, state) ? 1 : 0;
            case "<=":
                return this.numeric(left, expression.left.start, state) <= this.numeric(right, expression.right.start, state) ? 1 : 0;
            case ">":
                return this.numeric(left, expression.left.start, state) > this.numeric(right, expression.right.start, state) ? 1 : 0;
            case ">=":
                return this.numeric(left, expression.left.start, state) >= this.numeric(right, expression.right.start, state) ? 1 : 0;
            case "+":
                return typeof left === "string" || typeof right === "string"
                    ? `${left}${right}`
                    : this.numeric(left, expression.left.start, state) + this.numeric(right, expression.right.start, state);
            case "-":
                return this.numeric(left, expression.left.start, state) - this.numeric(right, expression.right.start, state);
            case "*":
                return this.numeric(left, expression.left.start, state) * this.numeric(right, expression.right.start, state);
            case "/": {
                const divisor = this.numeric(right, expression.right.start, state);
                if (divisor === 0) {
                    throw this.error(state.sourceName, expression.right.start, "Division by zero");
                }
                return this.numeric(left, expression.left.start, state) / divisor;
            }
            case "%": {
                const divisor = this.numeric(right, expression.right.start, state);
                if (divisor === 0) {
                    throw this.error(state.sourceName, expression.right.start, "Division by zero");
                }
                return this.numeric(left, expression.left.start, state) % divisor;
            }
        }
    }

    private numeric(value: SCRValue, location: SCRSourceLocation, state: ExecutionState): number {
        if (typeof value === "number") {
            return value;
        }
        if (typeof value === "boolean") {
            return value ? 1 : 0;
        }
        throw this.error(state.sourceName, location, "Expected a numeric value");
    }

    private step(location: SCRSourceLocation, state: ExecutionState): void {
        state.steps += 1;
        if (state.steps > state.limits.maxSteps) {
            throw this.error(state.sourceName, location, `Execution step limit of ${state.limits.maxSteps} exceeded`);
        }
    }

    private error(sourceName: string, location: SCRSourceLocation, message: string): SCRRuntimeError {
        return new SCRRuntimeError(sourceName, location, message);
    }
}
