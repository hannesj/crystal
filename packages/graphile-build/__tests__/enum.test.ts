import { GraphQLEnumType } from "graphql";

import { buildSchema, defaultPlugins } from "../src";

declare global {
  namespace GraphileEngine {
    interface ScopeGraphQLEnumType {
      isMyEnum?: boolean;
    }
  }
}

const EnumPlugin: GraphileEngine.Plugin = (builder) => {
  builder.hook("init", (_, build) => {
    build.registerEnumType(
      "MyEnum",
      { isMyEnum: true },
      () => ({
        values: {
          ONE: { value: 1 },
          TWO: { value: 2 },
          THREE: { value: 3 },
        },
      }),
      "enum.test.ts",
    );
    return _;
  });

  builder.hook("GraphQLObjectType:fields", (fields, build, context) => {
    const { extend, getTypeByName } = build;
    const {
      scope: { isRootQuery },
    } = context;
    if (!isRootQuery) {
      return fields;
    }
    const MyEnum = getTypeByName("MyEnum");
    if (!MyEnum) {
      return fields;
    }
    return extend(
      fields,
      {
        enum: {
          type: MyEnum,
        },
      },
      "TEST",
    );
  });

  builder.hook("GraphQLEnumType:values", (values, build, context) => {
    const { extend } = build;
    const {
      scope: { isMyEnum },
    } = context;
    if (!isMyEnum) {
      return values;
    }
    return extend(
      values,
      {
        FOUR: { value: 4 },
      },
      "TEST",
    );
  });

  builder.hook("GraphQLEnumType:values:value", (value, build, context) => {
    const { extend } = build;
    const {
      scope: { isMyEnum },
    } = context;
    if (isMyEnum && value.value < 4) {
      return extend(
        value,
        {
          deprecationReason: "We no longer support numbers smaller than PI",
        },
        "TEST",
      );
    } else {
      return value;
    }
  });
};

test("generated schema", async () => {
  const schema = await buildSchema([...defaultPlugins, EnumPlugin]);
  expect(schema).toMatchSnapshot();
});
