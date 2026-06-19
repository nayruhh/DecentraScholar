export default function TabHeader({ title, subtitle }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#111322] md:text-3xl">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-[#7b8099]">{subtitle}</p> : null}
    </div>
  );
}
