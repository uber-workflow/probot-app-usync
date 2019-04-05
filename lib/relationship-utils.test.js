const suites = {
  getChild: [
    {
      env: '',
      args: ['foo', 'foo'],
      expected: undefined,
    },
    {
      env: 'parent > path/:child',
      args: ['parent', 'child'],
      expected: {name: 'child', path: 'path'},
    },
  ],
  getChildrenNames: [
    {
      env: '',
      args: ['foo'],
      expected: [],
    },
    {
      env: 'parent > path/:child',
      args: ['parent'],
      expected: ['child'],
    },
  ],
  getChildren: [
    {
      env: '',
      args: ['foo'],
      expected: [],
    },
    {
      env: 'parent > path/:child',
      args: ['parent'],
      expected: [{name: 'child', path: 'path'}],
    },
  ],
  getParentName: [
    {
      env: '',
      args: ['foo'],
      expected: undefined,
    },
    {
      env: 'parent > path/:child',
      args: ['child'],
      expected: 'parent',
    },
  ],
  hasChildren: [
    {
      env: '',
      args: ['foo'],
      expected: false,
    },
    {
      env: 'parent > path/:child',
      args: ['child'],
      expected: false,
    },
    {
      env: 'parent > path/:child',
      args: ['parent'],
      expected: true,
    },
  ],
  hasParent: [
    {
      env: '',
      args: ['foo'],
      expected: false,
    },
    {
      env: 'parent > path/:child',
      args: ['child'],
      expected: true,
    },
    {
      env: 'parent > path/:child',
      args: ['parent'],
      expected: false,
    },
  ],
  hasRelationship: [
    {
      env: '',
      args: ['foo'],
      expected: false,
    },
    {
      env: 'parent > path/:child',
      args: ['child'],
      expected: true,
    },
    {
      env: 'parent > path/:child',
      args: ['parent'],
      expected: true,
    },
  ],
  parseEnv: [
    {
      args: [],
      expected: new Map(),
    },
    {
      args: ['foo/bar > bar/:bar/baz'],
      expected: new Map([
        ['foo/bar', {children: [{name: 'bar/baz', path: 'bar'}]}],
        ['bar/baz', {parent: 'foo/bar'}],
      ]),
    },
  ],
};

for (const [methodName, tests] of Object.entries(suites)) {
  if (!tests.length) continue;

  test(methodName, () => {
    for (const test of tests) {
      const {args, expected} = test;

      if (test.hasOwnProperty('env')) {
        // force module re-load so env is re-parsed
        jest.resetModules();
        process.env.REPO_RELATIONSHIPS = test.env;
      }

      expect(require('./relationship-utils.js')[methodName](...args)).toEqual(
        expected,
      );
    }
  });
}
