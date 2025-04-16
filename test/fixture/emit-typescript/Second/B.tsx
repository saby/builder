import { print } from 'First/A';
import MyClass from 'Third/C';

export function repeat5(a: string): void {
   print(new MyClass(a, 5).generate());
}
