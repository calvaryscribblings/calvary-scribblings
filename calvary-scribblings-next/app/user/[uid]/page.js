import UserProfileClient from './UserProfileClient';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return [];
}

export default function Page({ params }) {
  return <UserProfileClient params={params} />;
}