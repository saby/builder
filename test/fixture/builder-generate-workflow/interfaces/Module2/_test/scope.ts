import { default as User } from 'ModuleWithAPI/_test/scope';

class SecondUser extends User {
    get(): {
        return {
            foo: 'foo2'
        };
    }
}

export const secondUser = new SecondUser();
