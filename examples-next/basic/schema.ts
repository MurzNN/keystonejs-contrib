import { createSchema, list, graphQLSchemaExtension, gql } from '@keystone-next/keystone/schema';
import {
  text,
  relationship,
  checkbox,
  password,
  timestamp,
  select,
  virtual,
} from '@keystone-next/fields';
import { file } from '@keystonejs-contrib-next/fields-file';
import { LocalFileAdapter, S3Adapter } from '@keystone-next/file-adapters-legacy';
import { document } from '@keystone-next/fields-document';
import { configureTracking } from '@keystonejs-contrib-next/list-plugins';

// import { cloudinaryImage } from '@keystone-next/cloudinary';
import { KeystoneListsAPI } from '@keystone-next/types';
import { KeystoneListsTypeInfo } from './.keystone/schema-types';
import { componentBlocks } from './admin/fieldViews/Content';

const localFileAdapter = new LocalFileAdapter({
  src: `.keystone/admin/public/images`,
  path: `/images`,
});

const s3Options = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  endpoint: process.env.S3_ENDPOINT,
  region: 'DUMMY',
};

const s3Adapter = new S3Adapter({
  bucket: process.env.S3_BUCKET,
  folder: process.env.S3_PATH,
  publicUrl: ({ id, filename, _meta }) =>
    `${process.env.S3_CDN_URL}/${process.env.S3_PATH}/${filename}`,
  s3Options,
  uploadParams: ({ filename, id, mimetype, encoding }) => ({
    ACL: 'public-read',
    Metadata: {
      keystone_id: `${id}`,
    },
  }),
});

// TODO: Can we generate this type based on withItemData in the main config?
type AccessArgs = {
  session?: {
    itemId?: string;
    listKey?: string;
    data?: {
      name?: string;
      isAdmin: boolean;
    };
  };
  item?: any;
};
export const access = {
  isAdmin: ({ session }: AccessArgs) => !!session?.data?.isAdmin,
};

const randomNumber = () => Math.round(Math.random() * 10);

const withTracking = configureTracking({});

export const lists = createSchema({
  User: list(withTracking({
    ui: {
      listView: {
        initialColumns: ['name', 'posts'],
      },
    },
    fields: {
      /** The user's first and last name. */
      name: text({ isRequired: true }),
      /** Email is used to log into the system. */
      email: text({ isRequired: true, isUnique: true }),
      // avatar: cloudinaryImage({
      //   cloudinary: {
      //     cloudName: '/* TODO */',
      //     apiKey: '/* TODO */',
      //     apiSecret: '/* TODO */',
      //   },
      // }),
      /** Used to log in. */
      password: password(),
      /** Administrators have more access to various lists and fields. */
      image: file({ adapter: s3Adapter }),
      isAdmin: checkbox({
        access: {
          create: access.isAdmin,
          read: access.isAdmin,
          update: access.isAdmin,
        },
        ui: {
          createView: {
            fieldMode: (args) => (access.isAdmin(args) ? 'edit' : 'hidden'),
          },
          itemView: {
            fieldMode: (args) => (access.isAdmin(args) ? 'edit' : 'read'),
          },
        },
      }),
      roles: text({}),
      phoneNumbers: relationship({
        ref: 'PhoneNumber.user',
        many: true,
        ui: {
          // TODO: Work out how to use custom views to customise the card + edit / create forms
          // views: './admin/fieldViews/user/phoneNumber',
          displayMode: 'cards',
          cardFields: ['type', 'value'],
          inlineEdit: { fields: ['type', 'value'] },
          inlineCreate: { fields: ['type', 'value'] },
          linkToItem: true,
          // removeMode: 'delete',
        },
      }),
      posts: relationship({ ref: 'Post.author', many: true }),
      randomNumber: virtual({
        graphQLReturnType: 'Float',
        resolver() {
          return randomNumber();
        },
      }),
    },
    hooks: {    
      afterDelete: ({ existingItem }) => {
        if (existingItem.image) {
          s3Adapter.delete(existingItem.image);
        }
      },
    },
  })),
  PhoneNumber: list(withTracking({
    ui: {
      isHidden: true,
      // parentRelationship: 'user',
    },
    fields: {
      label: virtual({
        resolver(item) {
          return `${item.type} - ${item.value}`;
        },
        ui: {
          listView: {
            fieldMode: 'hidden',
          },
          itemView: {
            fieldMode: 'hidden',
          },
        },
      }),
      user: relationship({ ref: 'User.phoneNumbers' }),
      type: select({
        options: [
          { label: 'Home', value: 'home' },
          { label: 'Work', value: 'work' },
          { label: 'Mobile', value: 'mobile' },
        ],
        ui: {
          displayMode: 'segmented-control',
        },
      }),
      value: text({}),
    },
  })),
  Post: list(withTracking({
    fields: {
      title: text(),
      status: select({
        options: [
          { label: 'Published', value: 'published' },
          { label: 'Draft', value: 'draft' },
        ],
        ui: {
          displayMode: 'segmented-control',
        },
      }),
      content: document({
        ui: { views: require.resolve('./admin/fieldViews/Content.tsx') },
        relationships: {
          mention: {
            kind: 'inline',
            label: 'Mention',
            listKey: 'User',
          },
          featuredAuthors: {
            kind: 'prop',
            listKey: 'User',
            many: true,
            selection: `posts(first: 10) {
            title
          }`,
          },
        },
        formatting: true,
        layouts: [
          [1, 1],
          [1, 1, 1],
          [2, 1],
          [1, 2],
          [1, 2, 1],
        ],
        links: true,
        dividers: true,
        componentBlocks,
      }),
      publishDate: timestamp(),
      author: relationship({
        ref: 'User.posts',
        ui: {
          displayMode: 'cards',
          cardFields: ['name', 'email'],
          inlineEdit: { fields: ['name', 'email'] },
          linkToItem: true,
          inlineCreate: { fields: ['name', 'email'] },
        },
      }),
    },
  })),
});

export const extendGraphqlSchema = graphQLSchemaExtension({
  typeDefs: gql`
    type Query {
      randomNumber: RandomNumber
    }
    type RandomNumber {
      number: Int
      generatedAt: Int
    }
    type Mutation {
      createRandomPosts: [Post!]!
    }
  `,
  resolvers: {
    RandomNumber: {
      number(rootVal: { number: number }) {
        return rootVal.number * 1000;
      },
    },
    Mutation: {
      createRandomPosts(root, args, context) {
        // TODO: add a way to verify access control here, e.g
        // await context.verifyAccessControl(userIsAdmin);
        const lists: KeystoneListsAPI<KeystoneListsTypeInfo> = context.lists;
        const data = Array.from({ length: 238 }).map((x, i) => ({ data: { title: `Post ${i}` } }));
        return lists.Post.createMany({ data });
      },
    },
    Query: {
      randomNumber: () => ({
        number: randomNumber(),
        generatedAt: Date.now(),
      }),
    },
  },
});
