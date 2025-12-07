// Sample TypeScript file for testing
export class TestClass {
  constructor(private name: string) {}

  greet(): string {
    return `Hello, ${this.name}!`;
  }

  searchMe(): void {
    console.log('This is a test function');
  }
}

// Another function to search for
function anotherFunction() {
  const test = 'search test';
  return test;
}