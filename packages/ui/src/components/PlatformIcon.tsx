interface PlatformIconProps {
  platformId: string;
  size?: number;
}

function IconSvg({ size, bg, children }: { size: number; bg: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="22" height="22" rx="5.5" fill={bg} />
      {children}
    </svg>
  );
}

export function PlatformIcon({ platformId, size = 18 }: PlatformIconProps) {
  if (platformId.includes('xhs')) {
    return (
      <IconSvg size={size} bg="#FF2442">
        {/* stylized open book / heart mark for 小红书 */}
        <path d="M12 6.5C12 6.5 9.5 5 7.5 5C7 5 7 5.3 7 5.8V16.5C7 16.5 9.5 14.5 12 12.5C12 12.5 14.5 14.5 17 16.5V5.8C17 5.3 17 5 16.5 5C14.5 5 12 6.5 12 6.5Z" fill="white" opacity="0.85" />
        <path d="M12 12.5C12 12.5 14.5 14.5 17 16.5V5.8C17 5.3 17 5 16.5 5C14.5 5 12 6.5 12 6.5V12.5Z" fill="white" />
      </IconSvg>
    );
  }

  if (platformId.includes('douyin')) {
    return (
      <IconSvg size={size} bg="#111111">
        {/* music note / douyin mark */}
        <path d="M16 6.5V14C16 16 14.5 17.5 12.5 17.5C10.5 17.5 9 16 9 14C9 12 10.5 10.5 12.5 10.5C13 10.5 13.5 10.6 14 10.8V6.5H16Z" fill="#00F2EA" />
        <path d="M14 6.5H16V3H13V10.8C13 10.6 12.5 10.5 12 10.5C10 10.5 9 11.5 9 13.5C9 15.5 10.5 17 12 17C13.5 17 14.5 15.5 14.5 14V6.5H14Z" fill="#FE2C55" />
      </IconSvg>
    );
  }

  if (platformId.includes('bilibili')) {
    return (
      <IconSvg size={size} bg="#00A1D6">
        {/* TV with antenna */}
        <rect x="7.5" y="10" width="9" height="7" rx="1.5" fill="white" />
        <path d="M7.5 13.5H16.5" stroke="#00A1D6" strokeWidth="0.8" />
        <circle cx="12" cy="13.5" r="0.8" fill="#00A1D6" />
        <line x1="8.5" y1="10" x2="10.5" y2="7.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="15.5" y1="10" x2="13.5" y2="7.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="10.5" cy="7" r="1.2" fill="white" />
        <circle cx="13.5" cy="7" r="1.2" fill="white" />
      </IconSvg>
    );
  }

  if (platformId.includes('weibo')) {
    return (
      <IconSvg size={size} bg="#E6162D">
        {/* eye / weibo mark */}
        <ellipse cx="12" cy="12" rx="5.5" ry="4.5" fill="none" stroke="white" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="2.5" fill="white" />
        <path d="M9 8C9 8 10.5 7 12 7C13.5 7 15 8 15 8" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
      </IconSvg>
    );
  }

  if (platformId.includes('twitter') || platformId.includes('x.com')) {
    return (
      <IconSvg size={size} bg="#0F1419">
        {/* X mark */}
        <path d="M7.5 7L11.5 12L7 17H8.5L12 13L15 17H17.5L13 11.5L17 7H15.5L12.5 10.5L10 7H7.5Z" fill="white" />
      </IconSvg>
    );
  }

  // default: generic globe/network
  return (
    <IconSvg size={size} bg="#6B7280">
      <circle cx="12" cy="12" r="6" stroke="white" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="3" ry="6" stroke="white" strokeWidth="1.2" />
      <line x1="6" y1="12" x2="18" y2="12" stroke="white" strokeWidth="1.2" />
    </IconSvg>
  );
}
