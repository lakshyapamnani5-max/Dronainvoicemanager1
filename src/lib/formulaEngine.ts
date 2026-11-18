/**
 * Safe Mathematical Formula Engine for Custom Invoice Layouts.
 * 
 * Evaluates row-level calculations (e.g. "total_sq_ft * rate_sq_ft" or "qty * length * width * rate").
 * Pure arithmetic evaluator: ZERO eval(), ZERO Function constructor, ZERO arbitrary code execution.
 */

export interface FormulaToken {
  type: 'NUMBER' | 'IDENTIFIER' | 'OPERATOR' | 'LPAREN' | 'RPAREN';
  value: string;
}

export function tokenizeFormula(formula: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let i = 0;
  const str = formula.trim();

  while (i < str.length) {
    const ch = str[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '×' || ch === '÷') {
      const normalizedOp = ch === '×' ? '*' : ch === '÷' ? '/' : ch;
      tokens.push({ type: 'OPERATOR', value: normalizedOp });
      i++;
      continue;
    }

    // Number literal
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(str[i + 1] || ''))) {
      let numStr = '';
      while (i < str.length && (/[\d.]/.test(str[i]))) {
        numStr += str[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: numStr });
      continue;
    }

    // Identifier (column machine key, e.g. "total_sq_ft", "rate", "qty_1")
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
        ident += str[i];
        i++;
      }
      tokens.push({ type: 'IDENTIFIER', value: ident });
      continue;
    }

    // Unknown character encountered
    throw new Error(`Unexpected character '${ch}' at index ${i}`);
  }

  return tokens;
}

/**
 * Validate formula syntax and check that all referenced column keys exist.
 */
export function validateFormula(
  formula: string,
  availableColumnKeys: string[] = []
): { isValid: boolean; error?: string; usedKeys: string[] } {
  if (!formula || !formula.trim()) {
    return { isValid: false, error: 'Formula cannot be empty', usedKeys: [] };
  }

  try {
    const tokens = tokenizeFormula(formula);
    if (tokens.length === 0) {
      return { isValid: false, error: 'Formula is empty', usedKeys: [] };
    }

    const keySet = new Set(availableColumnKeys.map((k) => k.toLowerCase()));
    const usedKeys: string[] = [];
    let parenDepth = 0;
    let prevToken: FormulaToken | null = null;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      if (tok.type === 'IDENTIFIER') {
        const lowerKey = tok.value.toLowerCase();
        if (availableColumnKeys.length > 0 && !keySet.has(lowerKey)) {
          return {
            isValid: false,
            error: `Unknown column '${tok.value}'. Available: ${availableColumnKeys.join(', ')}`,
            usedKeys,
          };
        }
        if (!usedKeys.includes(tok.value)) {
          usedKeys.push(tok.value);
        }
      }

      if (tok.type === 'LPAREN') parenDepth++;
      if (tok.type === 'RPAREN') {
        parenDepth--;
        if (parenDepth < 0) {
          return { isValid: false, error: 'Mismatched parentheses (extra closing paren)', usedKeys };
        }
      }

      // Check consecutive operators or invalid grammar
      if (prevToken) {
        if (prevToken.type === 'OPERATOR' && tok.type === 'OPERATOR') {
          return { isValid: false, error: `Consecutive operators '${prevToken.value} ${tok.value}'`, usedKeys };
        }
        if (prevToken.type === 'OPERATOR' && tok.type === 'RPAREN') {
          return { isValid: false, error: `Operator followed by ')'`, usedKeys };
        }
        if (prevToken.type === 'LPAREN' && tok.type === 'OPERATOR' && tok.value !== '-') {
          return { isValid: false, error: `Operator directly after '('`, usedKeys };
        }
        if ((prevToken.type === 'NUMBER' || prevToken.type === 'IDENTIFIER') &&
            (tok.type === 'NUMBER' || tok.type === 'IDENTIFIER')) {
          return { isValid: false, error: `Missing operator between '${prevToken.value}' and '${tok.value}'`, usedKeys };
        }
      }

      prevToken = tok;
    }

    if (parenDepth !== 0) {
      return { isValid: false, error: 'Unclosed opening parenthesis', usedKeys };
    }

    if (prevToken && prevToken.type === 'OPERATOR') {
      return { isValid: false, error: `Formula ends with dangling operator '${prevToken.value}'`, usedKeys };
    }

    return { isValid: true, usedKeys };
  } catch (err: any) {
    return { isValid: false, error: err.message || 'Invalid formula', usedKeys: [] };
  }
}

/**
 * Extract identifiers used in a formula.
 */
export function extractFormulaDependencies(formula: string): string[] {
  try {
    const tokens = tokenizeFormula(formula);
    const deps: string[] = [];
    for (const t of tokens) {
      if (t.type === 'IDENTIFIER' && !deps.includes(t.value)) {
        deps.push(t.value);
      }
    }
    return deps;
  } catch {
    return [];
  }
}

/**
 * Convert infix tokens to Reverse Polish Notation (RPN) using Shunting-Yard.
 */
function shuntingYard(tokens: FormulaToken[]): FormulaToken[] {
  const output: FormulaToken[] = [];
  const opStack: FormulaToken[] = [];

  const precedence: Record<string, number> = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'NUMBER' || token.type === 'IDENTIFIER') {
      output.push(token);
    } else if (token.type === 'OPERATOR') {
      // Handle unary minus: if '-' is the first token or follows an operator or LPAREN
      const isUnaryMinus =
        token.value === '-' &&
        (i === 0 || tokens[i - 1].type === 'OPERATOR' || tokens[i - 1].type === 'LPAREN');

      if (isUnaryMinus) {
        output.push({ type: 'NUMBER', value: '0' });
      }

      while (
        opStack.length > 0 &&
        opStack[opStack.length - 1].type === 'OPERATOR' &&
        precedence[opStack[opStack.length - 1].value] >= precedence[token.value]
      ) {
        output.push(opStack.pop()!);
      }
      opStack.push(token);
    } else if (token.type === 'LPAREN') {
      opStack.push(token);
    } else if (token.type === 'RPAREN') {
      while (opStack.length > 0 && opStack[opStack.length - 1].type !== 'LPAREN') {
        output.push(opStack.pop()!);
      }
      if (opStack.length > 0 && opStack[opStack.length - 1].type === 'LPAREN') {
        opStack.pop(); // Remove LPAREN
      }
    }
  }

  while (opStack.length > 0) {
    output.push(opStack.pop()!);
  }

  return output;
}

/**
 * Evaluates an arithmetic formula against a row dictionary.
 * Supports decimal precision rounding.
 */
export function evaluateFormula(
  formula: string,
  rowData: Record<string, any> = {},
  decimals = 2
): number {
  if (!formula || !formula.trim()) return 0;

  try {
    const tokens = tokenizeFormula(formula);
    if (tokens.length === 0) return 0;

    const rpn = shuntingYard(tokens);
    const evalStack: number[] = [];

    // Case-insensitive lookup map
    const normalizedData: Record<string, number> = {};
    for (const [k, v] of Object.entries(rowData)) {
      normalizedData[k.toLowerCase()] = Number(v) || 0;
    }

    for (const tok of rpn) {
      if (tok.type === 'NUMBER') {
        evalStack.push(parseFloat(tok.value) || 0);
      } else if (tok.type === 'IDENTIFIER') {
        const val = normalizedData[tok.value.toLowerCase()] ?? 0;
        evalStack.push(val);
      } else if (tok.type === 'OPERATOR') {
        const b = evalStack.pop() ?? 0;
        const a = evalStack.pop() ?? 0;

        let res = 0;
        switch (tok.value) {
          case '+':
            res = a + b;
            break;
          case '-':
            res = a - b;
            break;
          case '*':
            res = a * b;
            break;
          case '/':
            res = b === 0 ? 0 : a / b;
            break;
        }
        evalStack.push(res);
      }
    }

    const result = evalStack.pop() ?? 0;
    if (typeof decimals === 'number' && decimals >= 0) {
      const factor = Math.pow(10, decimals);
      return Math.round(result * factor) / factor;
    }
    return result;
  } catch {
    return 0;
  }
}
