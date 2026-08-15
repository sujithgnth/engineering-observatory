import { gql } from "@apollo/client";

const client = {
  query: (_input: unknown) => Promise.resolve([]),
};

export function OrdersGraphqlService() {
  const query = gql`
    query Orders {
      orders {
        id
      }
    }
  `;
  return client.query({ query });
}
