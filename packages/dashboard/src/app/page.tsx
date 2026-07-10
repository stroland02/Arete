import { IconChartBar, IconBug, IconClock, IconActivity } from "@tabler/icons-react";

export default function DashboardOverview() {
  const metrics = [
    {
      title: "Total PRs Reviewed",
      value: "1,248",
      change: "+12.5%",
      positive: true,
      icon: <IconChartBar className="w-6 h-6 text-indigo-400" />,
    },
    {
      title: "Critical Bugs Prevented",
      value: "42",
      change: "+4.2%",
      positive: true,
      icon: <IconBug className="w-6 h-6 text-emerald-400" />,
    },
    {
      title: "Average Review Time",
      value: "12s",
      change: "-1.5s",
      positive: true,
      icon: <IconClock className="w-6 h-6 text-cyan-400" />,
    },
    {
      title: "Active Repositories",
      value: "24",
      change: "+2",
      positive: true,
      icon: <IconActivity className="w-6 h-6 text-purple-400" />,
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000 ease-out">
      {/* Header section */}
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">
          Overview
        </h1>
        <p className="text-slate-400 text-lg">
          Monitor your AI-assisted code reviews and team performance in real-time.
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, i) => (
          <div key={i} className="glass-panel p-6 flex flex-col gap-4 group">
            <div className="flex justify-between items-start">
              <div className="p-3 bg-white/5 rounded-2xl border border-white/10 group-hover:bg-white/10 transition-colors">
                {metric.icon}
              </div>
              <div className={`px-2.5 py-1 rounded-full text-xs font-medium border ${metric.positive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                {metric.change}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">{metric.title}</p>
              <h3 className="text-3xl font-bold text-white tracking-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-indigo-300 transition-all">
                {metric.value}
              </h3>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-panel p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Review Activity</h2>
            <button className="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
              View All
            </button>
          </div>
          <div className="h-64 flex items-center justify-center border border-white/5 rounded-xl bg-white/[0.02] backdrop-blur-sm">
            <p className="text-slate-500 flex items-center gap-2">
              <IconActivity className="w-5 h-5" />
              Chart data will appear here
            </p>
          </div>
        </div>

        <div className="glass-panel p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Latest Alerts</h2>
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-white/5">
                <div className="w-2 h-2 mt-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]" />
                <div>
                  <p className="text-sm font-medium text-slate-200">Critical vulnerability found</p>
                  <p className="text-xs text-slate-500 mt-1">PR #892 • 10m ago</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
