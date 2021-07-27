import {User as IUser} from 'ModuleWithAPI/scope';

class SecondUser implements IUser {
    get(): {
        return {
            foo: 'foo2'
        };
    }
}

export const secondUser = new SecondUser();
export { IUser };