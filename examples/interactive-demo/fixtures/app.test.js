// Test file for app.js

const { add, subtract, multiply, divide, calculate } = require('../app.js');

function testAdd() {
  const result = add(2, 3);
  if (result !== 5) {
    console.log(`TEST FAILED: add(2, 3) = ${result}, expected 5`);
    return false;
  }
  console.log('TEST PASSED: add');
  return true;
}

function testSubtract() {
  const result = subtract(5, 3);
  if (result !== 2) {
    console.log(`TEST FAILED: subtract(5, 3) = ${result}, expected 2`);
    return false;
  }
  console.log('TEST PASSED: subtract');
  return true;
}

function testDivide() {
  if (divide(6, 2) !== 3) {
    console.log('TEST FAILED: divide(6, 2)');
    return false;
  }

  const result = divide(5, 0);
  if (result !== null && result !== undefined && !Number.isNaN(result)) {
    console.log('TEST FAILED: divide(5, 0) should handle division by zero');
    return false;
  }

  console.log('TEST PASSED: divide');
  return true;
}

function testCalculate() {
  const result = calculate('2 + 3');
  if (result !== 5) {
    console.log(`TEST FAILED: calculate("2 + 3") = ${result}, expected 5`);
    return false;
  }
  console.log('TEST PASSED: calculate');
  return true;
}

const results = [testAdd(), testSubtract(), testDivide(), testCalculate()];
const passed = results.filter(r => r).length;
const total = results.length;

console.log(`\nResults: ${passed}/${total} tests passed`);

if (passed < total) {
  process.exit(1);
}

process.exit(0);
