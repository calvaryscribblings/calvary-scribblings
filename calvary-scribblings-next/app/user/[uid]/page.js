import UserProfileClient from './UserProfileClient';

export function generateStaticParams() {
  return [];
}

export default function Page({ params }) {
  return <UserProfileClient params={params} />;
}