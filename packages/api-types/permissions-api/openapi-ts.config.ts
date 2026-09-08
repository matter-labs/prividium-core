import * as path from 'node:path';

export default {
    input: path.resolve(__dirname, 'spec', 'openapi-spec.json'),
    output: path.resolve(__dirname, 'generated'),
    plugins: [
        '@hey-api/client-fetch',
        {
            name: '@hey-api/sdk',
            classNameBuilder: '{{name}}Api'
        }
    ]
};
