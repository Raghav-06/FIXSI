/** Customers and their saved addresses. */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export class Address {
  /** `country` is ISO 3166-1 alpha-2, e.g. "US". */
  constructor(line1, city, postalCode, country) {
    this.line1 = line1;
    this.city = city;
    this.postalCode = postalCode;
    this.country = country;
    Object.freeze(this);
  }
}

export class User {
  constructor({ id, email, name, addresses = {}, defaultLabel = "home" }) {
    this.id = id;
    this.email = email;
    this.name = name;
    this.addresses = addresses;
    this.defaultLabel = defaultLabel;
  }

  saveAddress(label, address, makeDefault = false) {
    this.addresses[label] = address;
    if (makeDefault || Object.keys(this.addresses).length === 1) {
      this.defaultLabel = label;
    }
  }
}

export class UserDirectory {
  constructor() {
    this._users = new Map();
    this._nextId = 1;
  }

  register(email, name) {
    if (!EMAIL_RE.test(email)) {
      throw new RangeError(`invalid email: ${JSON.stringify(email)}`);
    }
    if (this.findByEmail(email)) {
      throw new RangeError(`email already registered: ${email}`);
    }
    const user = new User({ id: `u_${this._nextId}`, email: email.toLowerCase(), name });
    this._nextId += 1;
    this._users.set(user.id, user);
    return user;
  }

  get(userId) {
    const user = this._users.get(userId);
    if (user === undefined) {
      throw new RangeError(`unknown user ${userId}`);
    }
    return user;
  }

  findByEmail(email) {
    const needle = email.toLowerCase();
    return [...this._users.values()].find((u) => u.email === needle) ?? null;
  }
}
