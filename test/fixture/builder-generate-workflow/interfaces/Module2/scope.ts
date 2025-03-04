import { default as User } from 'ModuleWithAPI/scope';

class SecondUser extends User {
    get(): {
        return {
            foo: 'foo2'
        };
    }
}

export const secondUser = new SecondUser();
