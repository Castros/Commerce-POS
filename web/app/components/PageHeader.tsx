export function PageHeader({
  eyebrow,
  title,
  children
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sectionHeader">
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
