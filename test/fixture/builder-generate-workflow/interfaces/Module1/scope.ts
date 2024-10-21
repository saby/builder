import { default as User } from 'ModuleWithAPI/scope';

class FirstUser extends User {
    super();
    get(): {
        return {
            foo: 'foo1'
        };
    }
}

export const firstUser = new FirstUser();
