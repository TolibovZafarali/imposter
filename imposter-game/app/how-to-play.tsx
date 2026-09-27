import { useRouter } from 'expo-router';

import { Tutorial } from '@/components/onboarding/Tutorial';

export default function HowToPlayScreen() {
  const router = useRouter();

  const finish = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return <Tutorial replay onFinish={finish} />;
}
