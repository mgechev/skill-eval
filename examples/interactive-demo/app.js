// Calculator module with bugs

function add(a, b) {
  return a - b;  // Bug: should be a + b
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  return a / b;  // Bug: no check for division by zero
}

function calculate(expression) {
  const parts = expression.split(' ');
  const a = parseFloat(parts[0]);
  const operator = parts[1];
  const b = parseFloat(parts[2]);

  switch (operator) {
    case '+':
      return add(a, b);
    case '-':
      return subtract(a, b);
    case '*':
      return multiply(a, b);
    case '/':
      return divide(a, b);
    default:
      return NaN;
  }
}

module.exports = { add, subtract, multiply, divide, calculate };
