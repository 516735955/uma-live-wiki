(function (root) {
  const roleFamilies = [
    {label:'原作与企划', pattern:/原作|漫画|企划|剧本监修|脚本监修/},
    {label:'导演与剧本', pattern:/导演|系列构成|故事构成|剧本|脚本/},
    {label:'分镜与演出', pattern:/分镜|演出|构图|编舞/},
    {label:'角色与设计', pattern:/角色设计|道具|服装|动作作画|作画动作|作画指导/},
    {label:'作画与动画', pattern:/原画|作画|中间动画|^动画$|数字修正/},
    {label:'美术', pattern:/美术|背景/},
    {label:'色彩与上色', pattern:/色彩|上色/},
    {label:'CG与二维制作', pattern:/CG|^3D|建模|模型|二维|^2D|动态图形|动作捕捉/},
    {label:'摄影与特效', pattern:/摄影|特效/},
    {label:'剪辑与后期', pattern:/剪辑|后期|收尾|母版/},
    {label:'音乐与音响', pattern:/音乐|音响|录音|调音|混音|声音|配音|乐手|乐谱|编配|弦乐|吉他|号角/},
    {label:'制作与制片', pattern:/制作|制片|统筹|管理|协调|经理|工程师|庶务|事务|内容总监|^出品/},
    {label:'宣传与发行', pattern:/宣传|发行|授权|上线|网站|销售|包装|广告|预告|推广|社交|媒体|编排/},
    {label:'协力与鸣谢', pattern:/协力|鸣谢|监修|翻译|毛笔字|旁白/}
  ];
  const leadOrder = ['原作','漫画','漫画脚本','漫画作画','企划','导演','副导演','助理导演','剧本总监','系列构成','故事构成','脚本','分镜','分镜协力','动画演出','动画演出助理','角色设计','角色设计监修','道具设计','服装／道具设计','总作画监督','动作作画监督','作画监督','作画监督助理','主要动画师','原画','第二原画','中间动画','中间动画检查','美术监督','美术监督助理','美术设定','美术背景','背景','色彩设计','色彩设计助理','色彩指定','上色检查','上色','3DCG总监','CG总监','3D监督','3D建模','3D动画师','3DCG','二维制作','摄影监督','摄影监督助理','摄影','特效','剪辑','离线剪辑','联机剪辑','音乐','音乐制片人','音响监督','音响效果','录音','调音','音响制作','动画制作','动画制片人','制作统筹','制作管理','制作','制片人','执行制片人','出品','出品委员会','宣传','发行','授权','协力','特别鸣谢'];
  function familyIndex(role) {
    if (roleFamilies[12].pattern.test(role)) return 12;
    return roleFamilies.findIndex(family => family.pattern.test(role));
  }
  function roleSection(role) {
    return (roleFamilies[familyIndex(role)] || {label:'其他岗位'}).label;
  }
  function roleRank(role) {
    const section = familyIndex(role);
    const order = leadOrder.indexOf(role);
    return (section < 0 ? roleFamilies.length : section) * 1000 + (order < 0 ? 500 : order);
  }
  function compareRoles(a, b) {
    return roleRank(a) - roleRank(b) || String(a).localeCompare(String(b),'zh');
  }
  function groupInstitutions(rows, entryOf = row => row) {
    const groups = new Map();
    function ensure(institutions) {
      const key = JSON.stringify(institutions);
      if (!groups.has(key)) groups.set(key, {key, institutions, rows: [], organizationRows: []});
      return groups.get(key);
    }
    const affiliations = rows.filter(row => !entryOf(row).organization)
      .map(row => [...new Set(entryOf(row).institutions || [])]);
    rows.forEach(row => {
      const entry = entryOf(row);
      if (entry.organization) {
        const institutions = affiliations.find(list => list.includes(entry.organization)) || [entry.organization];
        ensure(institutions).organizationRows.push(row);
      } else {
        ensure([...new Set(entry.institutions || [])]).rows.push(row);
      }
    });
    return Array.from(groups.values()).map(group => {
      const coveredUnits = new Set(group.rows.flatMap(row => row.units || []).map(unit => unit.id));
      const organizationUnits = new Map();
      group.organizationRows.forEach(row => (row.units || []).forEach(unit => {
        if (!coveredUnits.has(unit.id)) organizationUnits.set(unit.id, unit);
      }));
      return {...group, organizationUnits: Array.from(organizationUnits.values()).sort((a, b) => a.number - b.number)};
    });
  }
  function countLabel(rows, entryOf = row => row) {
    const people = new Set(rows.filter(row => !entryOf(row).organization)
      .map(row => entryOf(row).person_id || entryOf(row).name)).size;
    const institutions = new Set(rows.flatMap(row => {
      const entry = entryOf(row);
      return entry.organization ? [entry.organization] : entry.institutions || [];
    })).size;
    return [people ? `${people} 位` : '', institutions ? `${institutions} 家` : ''].filter(Boolean).join(' · ');
  }
  const staff = {groupInstitutions, countLabel, roleSection, roleRank, compareRoles};
  if (typeof module !== 'undefined' && module.exports) module.exports = staff;
  else root.UmaAnimeStaff = staff;
})(typeof window !== 'undefined' ? window : globalThis);
