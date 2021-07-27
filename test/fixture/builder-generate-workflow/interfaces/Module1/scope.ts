import {User as IUser} from 'ModuleWithAPI/scope';

class FirstUser implements IUser {
    get(): {
        return {
            foo: 'foo1'
        };
    }
}

export const firstUser = new FirstUser();
export { IUser };
