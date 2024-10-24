import { default as User } from 'ModuleWithAPI/_test/scope';

class FirstUser extends User {
    get(): {
        return {
            foo: 'foo1'
        };
    }
}

export const firstUser = new FirstUser();
